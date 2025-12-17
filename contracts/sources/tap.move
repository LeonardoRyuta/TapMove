module tap_market::tap_market {

    use std::signer;
    use std::error;
    use aptos_framework::timestamp;
    use aptos_framework::coin;
    use aptos_std::table::{Self, Table};

    use pyth::pyth;
    use pyth::price::Price;
    use pyth::price_identifier;
    use pyth::price; // helpers like price::get_price, price::get_expo, price::get_timestamp
    use pyth::i64;

    /***************
     *  ERRORS
     ***************/
    const E_NOT_ADMIN: u64 = 1;
    const E_MARKET_ALREADY_INIT: u64 = 2;
    const E_INVALID_PRICE_BUCKET: u64 = 3;
    const E_BET_TOO_SMALL: u64 = 4;
    const E_BET_TOO_LARGE: u64 = 5;
    const E_EXPIRY_TOO_SOON: u64 = 6;
    const E_EXPIRY_TOO_FAR: u64 = 7;
    const E_COLUMN_LOCKED: u64 = 8;
    const E_BET_ALREADY_SETTLED: u64 = 9;
    const E_INVALID_BET_ID: u64 = 10;
    const E_TOO_MANY_OPEN_BETS: u64 = 11;
    const E_NO_MARKET: u64 = 12;
    const E_HOUSE_INSUFFICIENT_LIQUIDITY: u64 = 13;
    const E_INVALID_ARGUMENT: u64 = 14;

    /***************
     *  DATA
     ***************/

    // Multiplier tuning
    // All values in basis points (1x = 10_000)
    const BASE_MULT_BPS: u64        = 10500;  // 1.05x at center, earliest expiry
    const DISTANCE_STEP_BPS: u64    = 600;    // +0.06x per price bucket from center
    const TIME_STEP_BPS: u64        = 800;    // +0.08x per extra time bucket beyond minimum
    const MAX_MULT_BPS: u64         = 100000; // cap at 10x


    /// Single bet: player picks a price bucket and an expiry time bucket.
    struct Bet has store {
        user: address,
        stake: u64,           // in CoinType units
        multiplier_bps: u64,  // 1x = 10_000
        price_bucket: u8,
        expiry_bucket: u64,
        settled: bool,
        won: bool,
    }

    // Global market parameters and house liquidity.
    struct Market<phantom CoinType> has key {
        admin: address,

        // House liquidity that pays out winners.
        house_vault: coin::Coin<CoinType>,

        // UI/grid config
        num_price_buckets: u8,
        mid_price_bucket: u8,      // “current price” bucket index

        // Time discretization (each column is one bucket):
        // bucket = timestamp / time_bucket_seconds
        time_bucket_seconds: u64,

        // How many future buckets users can bet into (anti-grief)
        max_expiry_buckets_ahead: u64,

        // How many future columns are locked (e.g. 1 => cannot bet on current or current+1)
        locked_columns_ahead: u64,

        // Spam / UX controls
        min_bet_size: u64,
        max_bet_size: u64,
        max_open_bets_per_user: u64,

        // Linear mapping from price -> bucket
        // anchor_price is the Pyth price that corresponds to mid_price_bucket
        // bucket_size is the price delta between adjacent buckets.
        anchor_price: i64,
        bucket_size: i64,

        // Pyth price feed ID for the asset (without 0x prefix, as bytes)
        price_feed_id: vector<u8>,

        // Storage
        next_bet_id: u64,
        bets: Table<u64, Bet>,
        user_open_bets: Table<address, u64>,
    }

    /***************
     *  HELPERS
     ***************/

    fun assert_admin<CoinType>(market: &Market<CoinType>, addr: address) {
        assert!(addr == market.admin, error::invalid_argument(E_NOT_ADMIN));
    }

    fun get_market_mut<CoinType>(addr: address): &mut Market<CoinType> {
        assert!(exists<Market<CoinType>>(addr), error::not_found(E_NO_MARKET));
        borrow_global_mut<Market<CoinType>>(addr)
    }

    fun get_market<CoinType>(addr: address): &Market<CoinType> {
        assert!(exists<Market<CoinType>>(addr), error::not_found(E_NO_MARKET));
        borrow_global<Market<CoinType>>(addr)
    }

    fun current_time_bucket<CoinType>(market: &Market<CoinType>): u64 {
        timestamp::now_seconds() / market.time_bucket_seconds
    }

    // Multiplier curve:
    /// - Higher for buckets further from the mid price (riskier)
    /// - Higher for bets further in the future (harder to predict),
    ///   which means that for a *fixed* expiry bucket, the multiplier
    ///   automatically decays as time advances and `current_bucket`
    ///   gets closer to `expiry_bucket`.
    fun compute_multiplier_bps<CoinType>(
        market: &Market<CoinType>,
        price_bucket: u8,
        expiry_bucket: u64,
        current_bucket: u64,
    ): u64 {
        let mid = market.mid_price_bucket as u64;
        let bucket = price_bucket as u64;

        // 1) Price-distance component (vertical axis)
        //    distance in rows from the middle bucket
        let price_distance =
            if (bucket > mid) { bucket - mid } else { mid - bucket };

        // 2) Time-distance component (horizontal axis)
        //    how many buckets into the future this bet settles
        let time_distance = expiry_bucket - current_bucket;

        // Earliest *allowed* offset:
        // - place_bet enforces:
        //   earliest_allowed_bucket = current_bucket + locked_columns_ahead + 1
        //   so minimum time_distance = locked_columns_ahead + 1
        let min_time_distance = market.locked_columns_ahead + 1;

        // Time bonus only for being further than the minimum required distance.
        // This is what makes further-out columns pay more, and nearer ones pay less.
        let time_bonus_bps = if (time_distance > min_time_distance) {
            (time_distance - min_time_distance) * TIME_STEP_BPS
        } else {
            0
        };

        // 3) Combine components
        let raw_mult_bps = BASE_MULT_BPS + price_distance * DISTANCE_STEP_BPS + time_bonus_bps;

        // 4) Clamp to sensible range [1.0x, MAX_MULT_BPS]
        let mult_bps = if (raw_mult_bps < 10_000) {
            10_000
        } else if (raw_mult_bps > MAX_MULT_BPS) {
            MAX_MULT_BPS
        } else {
            raw_mult_bps
        };

        mult_bps
    }


    /// Map a Pyth price into a bucket index using a linear mapping.
    /// - anchor_price is price at the mid bucket
    /// - bucket_size is price step per bucket
    /// Buckets are clamped to [0, num_price_buckets-1].
    fun map_price_to_bucket<CoinType>(
        market: &Market<CoinType>,
        p: &Price,
    ): u8 {
        let price_i64 = price::get_price(p); // signed integer price
        let diff = price_i64 - market.anchor_price;

        // integer division toward zero
        let steps = diff / market.bucket_size; // i64
        let mid_i64 = (market.mid_price_bucket as i64);
        let idx_i64 = mid_i64 + steps;

        let zero: i64 = 0;
        let max_i64 = (market.num_price_buckets as i64) - 1;

        let clamped =
            if (idx_i64 < zero) {
                zero
            } else if (idx_i64 > max_i64) {
                max_i64
            } else {
                idx_i64
            };

        clamped as u8
    }

    fun increment_open_bets<CoinType>(
        market: &mut Market<CoinType>,
        user: address,
    ) {
        let limit = market.max_open_bets_per_user;

        if (table::contains(&market.user_open_bets, user)) {
            let c_ref = table::borrow_mut(&mut market.user_open_bets, user);
            let new_val = *c_ref + 1;
            assert!(new_val <= limit, error::invalid_argument(E_TOO_MANY_OPEN_BETS));
            *c_ref = new_val;
        } else {
            assert!(1 <= limit, error::invalid_argument(E_TOO_MANY_OPEN_BETS));
            table::add(&mut market.user_open_bets, user, 1);
        }
    }

    fun decrement_open_bets<CoinType>(
        market: &mut Market<CoinType>,
        user: address,
    ) {
        if (!table::contains(&market.user_open_bets, user)) {
            return;
        };
        let c_ref = table::borrow_mut(&mut market.user_open_bets, user);
        // we don't let this go negative; if it hits 0 we can leave it as 0.
        if (*c_ref > 0) {
            *c_ref = *c_ref - 1;
        }
    }

    /***************
     *  INIT
     ***************/

    /// Initialize a market for CoinType.
    ///
    /// - price_feed_id: Pyth price feed ID bytes (no 0x prefix) for the asset
    /// - anchor_price / bucket_size: encoded in same units as price::get_price()
    public entry fun init_market<CoinType>(
        admin: &signer,
        num_price_buckets: u8,
        mid_price_bucket: u8,
        time_bucket_seconds: u64,
        max_expiry_buckets_ahead: u64,
        locked_columns_ahead: u64,
        min_bet_size: u64,
        max_bet_size: u64,
        max_open_bets_per_user: u64,
        anchor_price: i64,
        bucket_size: i64,
        price_feed_id: vector<u8>,
        initial_house_liquidity: coin::Coin<CoinType>,
    ) acquires Market {

        let admin_addr = signer::address_of(admin);
        assert!(!exists<Market<CoinType>>(admin_addr), error::already_exists(E_MARKET_ALREADY_INIT));

        assert!(num_price_buckets > 0, error::invalid_argument(E_INVALID_ARGUMENT));
        assert!((mid_price_bucket as u64) < (num_price_buckets as u64), error::invalid_argument(E_INVALID_PRICE_BUCKET));
        assert!(time_bucket_seconds > 0, error::invalid_argument(E_INVALID_ARGUMENT));
        assert!(min_bet_size > 0 && min_bet_size <= max_bet_size, error::invalid_argument(E_INVALID_ARGUMENT));
        assert!(bucket_size > 0, error::invalid_argument(E_INVALID_ARGUMENT));

        move_to(
            admin,
            Market<CoinType> {
                admin: admin_addr,
                house_vault: initial_house_liquidity,
                num_price_buckets,
                mid_price_bucket,
                time_bucket_seconds,
                max_expiry_buckets_ahead,
                locked_columns_ahead,
                min_bet_size,
                max_bet_size,
                max_open_bets_per_user,
                anchor_price,
                bucket_size,
                price_feed_id,
                next_bet_id: 0,
                bets: table::new<u64, Bet>(),
                user_open_bets: table::new<address, u64>(),
            }
        );
    }

    /***************
     *  PLACE BET
     ***************/

    /// User places a bet into a specific price bucket at a future time bucket.
    ///
    /// - expiry_timestamp_secs will be discretized into a time bucket.
    /// - Locked-column rule: user may *not* bet on current bucket or the next
    ///   `locked_columns_ahead` buckets (e.g. locked_columns_ahead = 1 means
    ///   "cannot bet on current or current+1").
    public entry fun place_bet<CoinType>(
        user: &signer,
        stake: coin::Coin<CoinType>,
        price_bucket: u8,
        expiry_timestamp_secs: u64,
    ) acquires Market {
        let user_addr = signer::address_of(user);
        let market = get_market_mut<CoinType>(user_addr);

        // basic validation
        assert!((price_bucket as u64) < (market.num_price_buckets as u64), error::invalid_argument(E_INVALID_PRICE_BUCKET));

        let amount = coin::value(&stake);
        assert!(amount >= market.min_bet_size, error::invalid_argument(E_BET_TOO_SMALL));
        assert!(amount <= market.max_bet_size, error::invalid_argument(E_BET_TOO_LARGE));

        let current_bucket = current_time_bucket(market);
        let expiry_bucket = expiry_timestamp_secs / market.time_bucket_seconds;

        // must be in the future
        assert!(expiry_bucket > current_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));

        // not *too* far in the future
        assert!(
            expiry_bucket <= current_bucket + market.max_expiry_buckets_ahead,
            error::invalid_argument(E_EXPIRY_TOO_FAR)
        );

        // locked columns: cannot bet on (current_bucket + 1 ..= current_bucket + locked_columns_ahead)
        let earliest_allowed_bucket = current_bucket + market.locked_columns_ahead + 1;
        assert!(
            expiry_bucket >= earliest_allowed_bucket,
            error::invalid_argument(E_COLUMN_LOCKED)
        );

        // anti-spam: max concurrent open bets per user
        increment_open_bets(market, user_addr);

        // compute multiplier deterministically from config & bet
        let multiplier_bps = compute_multiplier_bps(market, price_bucket, expiry_bucket, current_bucket);

        // move the user's stake into the house vault
        coin::merge(&mut market.house_vault, stake);

        // store bet
        let bet_id = market.next_bet_id;
        market.next_bet_id = bet_id + 1;

        table::add(
            &mut market.bets,
            bet_id,
            Bet {
                user: user_addr,
                stake: amount,
                multiplier_bps,
                price_bucket,
                expiry_bucket,
                settled: false,
                won: false,
            }
        );
    }

    /***************
     *  SETTLEMENT (PYTH)
     ***************/

    /// Settle a single bet:
    /// - only admin can call
    /// - must pass `pyth_price_update` from Hermes
    /// - contract pays the update fee from admin’s account
    /// - reads the Pyth price and maps it to a price bucket
    /// - if bucket matches bet.price_bucket, user wins
    ///
    /// NOTE:
    ///  - For now, this uses the Pyth price at *settlement time*.
    ///  - For a hackathon MVP you can just make your backend call this
    ///    right at (or just after) the bet’s expiry bucket to approximate
    ///    “price at expiry”.
    public entry fun settle_bet<CoinType>(
        admin: &signer,
        bet_id: u64,
        pyth_price_update: vector<vector<u8>>,
    ) acquires Market {
        let admin_addr = signer::address_of(admin);
        let market = get_market_mut<CoinType>(admin_addr);
        assert_admin(market, admin_addr);

        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));
        let bet_ref = table::borrow_mut(&mut market.bets, bet_id);
        assert!(!bet_ref.settled, error::invalid_argument(E_BET_ALREADY_SETTLED));

        // cannot settle before expiry bucket
        let now_bucket = current_time_bucket(market);
        assert!(now_bucket >= bet_ref.expiry_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));

        // 1) Pay Pyth update fee and update price feeds
        let fee = pyth::get_update_fee(&pyth_price_update);
        let fee_coins = coin::withdraw(admin, fee);
        pyth::update_price_feeds(pyth_price_update, fee_coins);

        // 2) Read price from our configured feed
        let price_id = price_identifier::from_byte_vec(market.price_feed_id);
        let price_struct: Price = pyth::get_price(price_id);

        // 3) Map price to price bucket
        let realized_bucket = map_price_to_bucket(market, &price_struct);

        // 4) Decide win/loss
        let did_win = realized_bucket == bet_ref.price_bucket;

        if (did_win) {
            let payout = bet_ref.stake * bet_ref.multiplier_bps / 10_000;
            let house_balance = coin::value(&market.house_vault);
            assert!(house_balance >= payout, error::invalid_state(E_HOUSE_INSUFFICIENT_LIQUIDITY));

            let payout_coins = coin::extract(&mut market.house_vault, payout);
            coin::deposit(bet_ref.user, payout_coins);
        };

        bet_ref.settled = true;
        bet_ref.won = did_win;

        // update spam counter
        decrement_open_bets(market, bet_ref.user);
    }
}
