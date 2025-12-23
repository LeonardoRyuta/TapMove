module tap_market::tap_market {
    use std::signer;
    use std::error;

    use aptos_framework::timestamp;
    use aptos_framework::coin;
    use aptos_framework::event;
    use aptos_framework::account;

    use aptos_std::table::{Self, Table};

    use pyth::pyth;
    use pyth::price::Price;
    use pyth::price_identifier;
    use pyth::price;
    use pyth::i64::I64;

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
     *  EVENTS
     ***************/
    struct BetPlacedEvent has drop, store {
        user: address,
        bet_id: u64,
        price_bucket: u8,
        expiry_bucket: u64,
        stake: u64,
        multiplier_bps: u64,
    }

    struct BetEvents has key {
        bet_placed_event: event::EventHandle<BetPlacedEvent>,
    }

    fun ensure_event_store(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        if (!exists<BetEvents>(admin_addr)) {
            // IMPORTANT: use account::new_event_handle, not event::new_event_handle
            // because event::new_event_handle expects guid::GUID. :contentReference[oaicite:1]{index=1}
            move_to(admin, BetEvents {
                bet_placed_event: account::new_event_handle<BetPlacedEvent>(admin),
            });
        }
    }

    /***************
     *  DATA
     ***************/
    const BASE_MULT_BPS: u64     = 10_500;  // 1.05x at center, earliest expiry
    const DISTANCE_STEP_BPS: u64 = 600;     // +0.06x per price bucket from center
    const TIME_STEP_BPS: u64     = 800;     // +0.08x per extra time bucket beyond minimum
    const MAX_MULT_BPS: u64      = 100_000; // cap at 10x

    struct Bet has store {
        user: address,
        stake: u64,
        multiplier_bps: u64,
        price_bucket: u8,
        expiry_bucket: u64,
        settled: bool,
        won: bool,
    }

    struct Market<phantom CoinType> has key {
        admin: address,

        house_vault: coin::Coin<CoinType>,

        num_price_buckets: u8,
        mid_price_bucket: u8,

        time_bucket_seconds: u64,
        max_expiry_buckets_ahead: u64,
        locked_columns_ahead: u64,

        min_bet_size: u64,
        max_bet_size: u64,
        max_open_bets_per_user: u64,

        anchor_price: I64,
        bucket_size: I64,

        price_feed_id: vector<u8>,

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

    fun current_time_bucket<CoinType>(market: &Market<CoinType>): u64 {
        timestamp::now_seconds() / market.time_bucket_seconds
    }

    fun compute_multiplier_bps<CoinType>(
        market: &Market<CoinType>,
        price_bucket: u8,
        expiry_bucket: u64,
        current_bucket: u64,
    ): u64 {
        let mid = market.mid_price_bucket as u64;
        let bucket = price_bucket as u64;

        let price_distance =
            if (bucket > mid) { bucket - mid } else { mid - bucket };

        let time_distance = expiry_bucket - current_bucket;
        let min_time_distance = market.locked_columns_ahead + 1;

        let time_bonus_bps = if (time_distance > min_time_distance) {
            (time_distance - min_time_distance) * TIME_STEP_BPS
        } else {
            0
        };

        let raw_mult_bps =
            BASE_MULT_BPS
            + price_distance * DISTANCE_STEP_BPS
            + time_bonus_bps;

        if (raw_mult_bps < 10_000) { 10_000 }
        else if (raw_mult_bps > MAX_MULT_BPS) { MAX_MULT_BPS }
        else { raw_mult_bps }
    }

    fun map_price_to_bucket(
        num_price_buckets: u8,
        mid_price_bucket: u8,
        anchor_price: &I64,
        bucket_size: &I64,
        p: &Price,
    ): u8 {
        let price_i64 = price::get_price(p);

        let price_val = if (pyth::i64::get_is_negative(&price_i64)) {
            0
        } else {
            pyth::i64::get_magnitude_if_positive(&price_i64)
        };

        let anchor_val = if (pyth::i64::get_is_negative(anchor_price)) {
            0
        } else {
            pyth::i64::get_magnitude_if_positive(anchor_price)
        };

        let bucket_val = pyth::i64::get_magnitude_if_positive(bucket_size);

        let mid = mid_price_bucket as u64;

        let idx = if (price_val >= anchor_val) {
            let diff = price_val - anchor_val;
            let steps = diff / bucket_val;
            mid + steps
        } else {
            let diff = anchor_val - price_val;
            let steps = diff / bucket_val;
            if (steps > mid) { 0 } else { mid - steps }
        };

        let max_bucket = (num_price_buckets as u64) - 1;
        let clamped = if (idx > max_bucket) { max_bucket } else { idx };
        clamped as u8
    }

    fun increment_open_bets<CoinType>(market: &mut Market<CoinType>, user: address) {
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

    fun decrement_open_bets<CoinType>(market: &mut Market<CoinType>, user: address) {
        if (!table::contains(&market.user_open_bets, user)) return;
        let c_ref = table::borrow_mut(&mut market.user_open_bets, user);
        if (*c_ref > 0) *c_ref = *c_ref - 1;
    }

    /***************
     *  INIT
     ***************/
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
        anchor_price_magnitude: u64,
        anchor_price_negative: bool,
        bucket_size_magnitude: u64,
        bucket_size_negative: bool,
        price_feed_id: vector<u8>,
        initial_house_liquidity_amount: u64,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(
            !exists<Market<CoinType>>(admin_addr),
            error::already_exists(E_MARKET_ALREADY_INIT)
        );

        ensure_event_store(admin);

        let anchor_price = pyth::i64::new(anchor_price_magnitude, anchor_price_negative);
        let bucket_size = pyth::i64::new(bucket_size_magnitude, bucket_size_negative);

        let initial_house_liquidity =
            coin::withdraw<CoinType>(admin, initial_house_liquidity_amount);

        assert!(num_price_buckets > 0, error::invalid_argument(E_INVALID_ARGUMENT));
        assert!(
            (mid_price_bucket as u64) < (num_price_buckets as u64),
            error::invalid_argument(E_INVALID_PRICE_BUCKET)
        );
        assert!(time_bucket_seconds > 0, error::invalid_argument(E_INVALID_ARGUMENT));
        assert!(
            min_bet_size > 0 && min_bet_size <= max_bet_size,
            error::invalid_argument(E_INVALID_ARGUMENT)
        );
        assert!(
            !pyth::i64::get_is_negative(&bucket_size)
                && pyth::i64::get_magnitude_if_positive(&bucket_size) > 0,
            error::invalid_argument(E_INVALID_ARGUMENT)
        );

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
    public entry fun place_bet<CoinType>(
        user: &signer,
        market_admin: address,
        stake_amount: u64,
        price_bucket: u8,
        expiry_timestamp_secs: u64,
    ) acquires Market, BetEvents {
        let user_addr = signer::address_of(user);

        assert!(exists<Market<CoinType>>(market_admin), error::not_found(E_NO_MARKET));
        let market = borrow_global_mut<Market<CoinType>>(market_admin);

        assert!(
            (price_bucket as u64) < (market.num_price_buckets as u64),
            error::invalid_argument(E_INVALID_PRICE_BUCKET)
        );

        assert!(stake_amount >= market.min_bet_size, error::invalid_argument(E_BET_TOO_SMALL));
        assert!(stake_amount <= market.max_bet_size, error::invalid_argument(E_BET_TOO_LARGE));

        let stake = coin::withdraw<CoinType>(user, stake_amount);

        let current_bucket = current_time_bucket(market);
        let expiry_bucket = expiry_timestamp_secs / market.time_bucket_seconds;

        assert!(expiry_bucket > current_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));
        assert!(
            expiry_bucket <= current_bucket + market.max_expiry_buckets_ahead,
            error::invalid_argument(E_EXPIRY_TOO_FAR)
        );

        let earliest_allowed_bucket = current_bucket + market.locked_columns_ahead + 1;
        assert!(expiry_bucket >= earliest_allowed_bucket, error::invalid_argument(E_COLUMN_LOCKED));

        increment_open_bets(market, user_addr);

        let multiplier_bps =
            compute_multiplier_bps(market, price_bucket, expiry_bucket, current_bucket);

        coin::merge(&mut market.house_vault, stake);

        let bet_id = market.next_bet_id;
        market.next_bet_id = bet_id + 1;

        table::add(
            &mut market.bets,
            bet_id,
            Bet {
                user: user_addr,
                stake: stake_amount,
                multiplier_bps,
                price_bucket,
                expiry_bucket,
                settled: false,
                won: false,
            }
        );

        // Emit BetPlacedEvent so frontend can grab bet_id from tx events immediately.
        let events = borrow_global_mut<BetEvents>(market_admin);
        event::emit_event(
            &mut events.bet_placed_event,
            BetPlacedEvent {
                user: user_addr,
                bet_id,
                price_bucket,
                expiry_bucket,
                stake: stake_amount,
                multiplier_bps,
            }
        );
    }

    /***************
     *  VIEWS (optional but useful)
     ***************/
    #[view]
    public fun get_next_bet_id<CoinType>(market_admin: address): u64 acquires Market {
        let market = borrow_global<Market<CoinType>>(market_admin);
        market.next_bet_id
    }

    #[view]
    public fun bet_exists<CoinType>(market_admin: address, bet_id: u64): bool acquires Market {
        let market = borrow_global<Market<CoinType>>(market_admin);
        table::contains(&market.bets, bet_id)
    }

    /// Debug view: Check if bet exists and return basic info
    /// Returns: (exists, user, price_bucket, expiry_bucket, stake, multiplier_bps, settled, won)
    #[view]
    public fun get_bet_debug<CoinType>(
        market_admin: address,
        bet_id: u64
    ): (bool, address, u8, u64, u64, u64, bool, bool) acquires Market {
        if (!exists<Market<CoinType>>(market_admin)) {
            return (false, @0x0, 0, 0, 0, 0, false, false)
        };
        let market = borrow_global<Market<CoinType>>(market_admin);
        if (!table::contains(&market.bets, bet_id)) {
            return (false, @0x0, 0, 0, 0, 0, false, false)
        };
        let bet = table::borrow(&market.bets, bet_id);
        (
            true,
            bet.user,
            bet.price_bucket,
            bet.expiry_bucket,
            bet.stake,
            bet.multiplier_bps,
            bet.settled,
            bet.won
        )
    }

    /// Debug view: Check if a user has any open bets tracked
    #[view]
    public fun get_user_open_bets<CoinType>(
        market_admin: address,
        user: address
    ): u64 acquires Market {
        if (!exists<Market<CoinType>>(market_admin)) {
            return 0
        };
        let market = borrow_global<Market<CoinType>>(market_admin);
        if (!table::contains(&market.user_open_bets, user)) {
            return 0
        };
        *table::borrow(&market.user_open_bets, user)
    }

    /// Debug view: Comprehensive bet existence check
    #[view]
    public fun bet_exists_view<CoinType>(market_admin: address, bet_id: u64): bool acquires Market {
        if (!exists<Market<CoinType>>(market_admin)) {
            return false
        };
        let market = borrow_global<Market<CoinType>>(market_admin);
        table::contains(&market.bets, bet_id)
    }

    /***************
     *  SETTLEMENT (same as your original logic)
     ***************/
    public entry fun settle_bet<CoinType>(
        admin: &signer,
        bet_id: u64,
        pyth_price_update: vector<vector<u8>>,
    ) acquires Market {
        // Step 1: Check market exists
        let admin_addr = signer::address_of(admin);
        assert!(exists<Market<CoinType>>(admin_addr), error::not_found(E_NO_MARKET));
        
        // Step 2: Borrow market mutably
        let market = borrow_global_mut<Market<CoinType>>(admin_addr);
        
        // Step 3: Verify admin
        assert_admin(market, admin_addr);
        
        // Step 4: Guard - check bet exists before any table access
        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));

        // Step 5: Copy market fields needed for price mapping
        let time_bucket_seconds = market.time_bucket_seconds;
        let num_price_buckets = market.num_price_buckets;
        let mid_price_bucket = market.mid_price_bucket;
        let anchor_price_ref = &market.anchor_price;
        let bucket_size_ref = &market.bucket_size;
        let price_feed_id = market.price_feed_id;

        // Step 6: Update Pyth price feed
        let fee = pyth::get_update_fee(&pyth_price_update);
        let fee_coins = coin::withdraw(admin, fee);
        pyth::update_price_feeds(pyth_price_update, fee_coins);

        let price_id = price_identifier::from_byte_vec(price_feed_id);
        let price_struct: Price = pyth::get_price(price_id);

        let realized_bucket = map_price_to_bucket(
            num_price_buckets,
            mid_price_bucket,
            anchor_price_ref,
            bucket_size_ref,
            &price_struct,
        );

        // Step 7: Borrow bet immutably in a small scope to copy data
        let bet_user: address;
        let bet_price_bucket: u8;
        let bet_expiry_bucket: u64;
        let bet_stake: u64;
        let bet_multiplier_bps: u64;
        {
            // Safe: we already checked table::contains above
            let bet_copy = table::borrow(&market.bets, bet_id);
            assert!(!bet_copy.settled, error::invalid_argument(E_BET_ALREADY_SETTLED));
            bet_user = bet_copy.user;
            bet_price_bucket = bet_copy.price_bucket;
            bet_expiry_bucket = bet_copy.expiry_bucket;
            bet_stake = bet_copy.stake;
            bet_multiplier_bps = bet_copy.multiplier_bps;
        }; // bet_copy dropped here

        // Step 8: Check expiry
        let now_bucket = timestamp::now_seconds() / time_bucket_seconds;
        assert!(now_bucket >= bet_expiry_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));

        // Step 9: Determine win/loss
        let did_win = realized_bucket == bet_price_bucket;

        // Step 10: Pay out if won
        if (did_win) {
            let payout = bet_stake * bet_multiplier_bps / 10_000;
            let house_balance = coin::value(&market.house_vault);
            assert!(house_balance >= payout, error::invalid_state(E_HOUSE_INSUFFICIENT_LIQUIDITY));

            let payout_coins = coin::extract(&mut market.house_vault, payout);
            coin::deposit(bet_user, payout_coins);
        };

        // Step 11: Now safe to borrow_mut because we're done with immutable borrow
        // Guard: double-check bet still exists (defensive programming)
        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));
        let bet_ref_mut = table::borrow_mut(&mut market.bets, bet_id);
        bet_ref_mut.settled = true;
        bet_ref_mut.won = did_win;

        // Step 12: Decrement open bets (already has internal guard)
        decrement_open_bets(market, bet_user);
    }

    public entry fun settle_bet_public<CoinType>(
        caller: &signer,
        market_admin: address,
        bet_id: u64,
        pyth_price_update: vector<vector<u8>>,
    ) acquires Market {
        // Step 1: Check market exists
        assert!(exists<Market<CoinType>>(market_admin), error::not_found(E_NO_MARKET));
        
        // Step 2: Borrow market mutably
        let market = borrow_global_mut<Market<CoinType>>(market_admin);

        // Step 3: Guard - check bet exists before any table access
        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));

        // Step 4: Get current time bucket
        let now_bucket = current_time_bucket(market);

        // Step 5: Borrow bet immutably in a small scope to copy data
        let bet_user: address;
        let bet_price_bucket: u8;
        let bet_expiry_bucket: u64;
        let bet_stake: u64;
        let bet_multiplier_bps: u64;
        {
            // Safe: we already checked table::contains above
            let bet_copy = table::borrow(&market.bets, bet_id);
            assert!(!bet_copy.settled, error::invalid_argument(E_BET_ALREADY_SETTLED));
            bet_user = bet_copy.user;
            bet_price_bucket = bet_copy.price_bucket;
            bet_expiry_bucket = bet_copy.expiry_bucket;
            bet_stake = bet_copy.stake;
            bet_multiplier_bps = bet_copy.multiplier_bps;
        }; // bet_copy dropped here

        // Step 6: Check expiry
        assert!(now_bucket >= bet_expiry_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));

        // Step 7: Update Pyth price feed
        let fee = pyth::get_update_fee(&pyth_price_update);
        let fee_coins = coin::withdraw(caller, fee);
        pyth::update_price_feeds(pyth_price_update, fee_coins);

        // Step 8: Get price from Pyth
        // NOTE: Using hardcoded ETH/USD feed - consider using market.price_feed_id for consistency
        let price_identifier_bytes =
            x"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
        let price_id = price_identifier::from_byte_vec(price_identifier_bytes);
        let price_struct: Price = pyth::get_price(price_id);

        // Step 9: Map price to bucket
        let realized_bucket = map_price_to_bucket(
            market.num_price_buckets,
            market.mid_price_bucket,
            &market.anchor_price,
            &market.bucket_size,
            &price_struct,
        );

        // Step 10: Determine win/loss
        let did_win = realized_bucket == bet_price_bucket;

        // Step 11: Pay out if won
        if (did_win) {
            let payout = bet_stake * bet_multiplier_bps / 10_000;
            let house_balance = coin::value(&market.house_vault);
            assert!(house_balance >= payout, error::invalid_state(E_HOUSE_INSUFFICIENT_LIQUIDITY));

            let payout_coins = coin::extract(&mut market.house_vault, payout);
            coin::deposit(bet_user, payout_coins);
        };

        // Step 12: Now safe to borrow_mut because we're done with immutable borrow
        // Guard: double-check bet still exists (defensive programming)
        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));
        let bet_ref_mut = table::borrow_mut(&mut market.bets, bet_id);
        bet_ref_mut.settled = true;
        bet_ref_mut.won = did_win;

        // Step 13: Decrement open bets (already has internal guard)
        decrement_open_bets<CoinType>(market, bet_user);
    }

        /// Simplified settlement for hackathon MVP:
    /// - No on-chain Pyth call.
    /// - Frontend passes `realized_bucket` (computed off-chain from price).
    /// - Same payout logic, same checks.
    public entry fun settle_bet_public_no_pyth<CoinType>(
        caller: &signer,
        market_admin: address,
        bet_id: u64,
        realized_bucket: u8,
    ) acquires Market {
        // 1) Ensure market exists
        assert!(exists<Market<CoinType>>(market_admin), error::not_found(E_NO_MARKET));
        let market = borrow_global_mut<Market<CoinType>>(market_admin);

        // 2) Ensure bet exists
        assert!(table::contains(&market.bets, bet_id), error::not_found(E_INVALID_BET_ID));

        // 3) Current time bucket
        let now_bucket = current_time_bucket(market);

        // 4) Copy bet data in a small scope (immutable borrow)
        let bet_user: address;
        let bet_price_bucket: u8;
        let bet_expiry_bucket: u64;
        let bet_stake: u64;
        let bet_multiplier_bps: u64;
        {
            let bet_copy = table::borrow(&market.bets, bet_id);
            assert!(!bet_copy.settled, error::invalid_argument(E_BET_ALREADY_SETTLED));
            bet_user = bet_copy.user;
            bet_price_bucket = bet_copy.price_bucket;
            bet_expiry_bucket = bet_copy.expiry_bucket;
            bet_stake = bet_copy.stake;
            bet_multiplier_bps = bet_copy.multiplier_bps;
        }; // bet_copy dropped here

        // 5) Cannot settle before expiry bucket
        assert!(now_bucket >= bet_expiry_bucket, error::invalid_argument(E_EXPIRY_TOO_SOON));

        // 6) Decide win/loss using realized_bucket passed from frontend
        let did_win = realized_bucket == bet_price_bucket;

        // 7) Pay out if win
        if (did_win) {
            let payout = bet_stake * bet_multiplier_bps / 10_000;
            let house_balance = coin::value(&market.house_vault);
            assert!(
                house_balance >= payout,
                error::invalid_state(E_HOUSE_INSUFFICIENT_LIQUIDITY)
            );

            let payout_coins = coin::extract(&mut market.house_vault, payout);
            coin::deposit(bet_user, payout_coins);
        };

        // 8) Mark bet as settled
        let bet_ref_mut = table::borrow_mut(&mut market.bets, bet_id);
        bet_ref_mut.settled = true;
        bet_ref_mut.won = did_win;

        // 9) Update open bets count (has internal guard)
        decrement_open_bets(market, bet_user);

        // Note: `caller` is unused logically, but we keep it as signer
        // so anyone can call this. If you want to silence unused var
        // warnings, you can do:
        // let _caller_addr = signer::address_of(caller);
    }

}
