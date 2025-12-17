#[test_only]
module tap_market::tap_market_tests {
    use std::signer;
    use aptos_framework::account;
    use aptos_framework::timestamp;
    use aptos_framework::coin;

    use tap_market::tap_market;
    use tap_market::test_coin::{Self as TestCoinMod, TestCoin};

    //
    // 1) Happy-path test: init market + place a bet
    //
    #[test(aptos_framework = @aptos_framework, admin = @tap_market, user = @0x100)]
    public entry fun test_init_and_place_bet_succeeds(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        // ---- Init global time for tests ----
        // This publishes the `CurrentTimeMicroseconds` resource so now_seconds() works.
        timestamp::set_time_has_started_for_testing(aptos_framework);

        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);

        // Create accounts for test signers
        account::create_account_for_test(admin_addr);
        account::create_account_for_test(user_addr);

        // ---- Setup TestCoin ----
        TestCoinMod::init(admin);
        TestCoinMod::register(admin);
        TestCoinMod::register(user);

        // Mint balances to admin (house) and user (player)
        TestCoinMod::mint_to(admin, admin_addr, 1_000_000_000);
        TestCoinMod::mint_to(admin, user_addr, 1_000_000_000);

        // ---- Init market ----
        let num_price_buckets: u8 = 21;
        let mid_price_bucket: u8 = 10;
        let time_bucket_seconds: u64 = 10;
        let max_expiry_buckets_ahead: u64 = 20;
        let locked_columns_ahead: u64 = 1;
        let min_bet_size: u64 = 10;
        let max_bet_size: u64 = 1_000_000_000;
        let max_open_bets_per_user: u64 = 10;

        tap_market::init_market<TestCoin>(
            admin,
            num_price_buckets,
            mid_price_bucket,
            time_bucket_seconds,
            max_expiry_buckets_ahead,
            locked_columns_ahead,
            min_bet_size,
            max_bet_size,
            max_open_bets_per_user,
            /* anchor_price_magnitude */ 100_000_000,
            /* anchor_price_negative */ false,
            /* bucket_size_magnitude */ 10_000,
            /* bucket_size_negative */ false,
            /* price_feed_id */ b"",      // OK: we don't call settle_bet in this test
            /* initial_house_liquidity */ 100_000_000,
        );

        let user_before = coin::balance<TestCoin>(user_addr);
        let admin_before = coin::balance<TestCoin>(admin_addr);

        // ---- Place a valid bet ----
        // now_seconds() is safe now that we've set up the timestamp resource
        let now = timestamp::now_seconds();
        let expiry_ts = now + 40; // 4 buckets ahead @ 10s per bucket

        tap_market::place_bet<TestCoin>(
            user,
            admin_addr,
            /* stake_amount */ 100,
            /* price_bucket */ mid_price_bucket,
            expiry_ts,
        );

        // ---- Assertions: balances changed as expected ----
        let user_after = coin::balance<TestCoin>(user_addr);
        let admin_after = coin::balance<TestCoin>(admin_addr);

        // user paid 100 into the house vault
        assert!(user_after == user_before - 100, 0);
        // Stake goes into house_vault inside Market, not admin’s CoinStore
        assert!(admin_after == admin_before, 0);

    }

    //
    // 2) Bet smaller than min_bet_size must abort
    //
    #[test(aptos_framework = @aptos_framework, admin = @tap_market, user = @0x101)]
    #[expected_failure] // any abort is fine, we just care it fails
    public entry fun test_bet_too_small_rejected(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        timestamp::set_time_has_started_for_testing(aptos_framework);

        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);

        account::create_account_for_test(admin_addr);
        account::create_account_for_test(user_addr);

        TestCoinMod::init(admin);
        TestCoinMod::register(admin);
        TestCoinMod::register(user);
        TestCoinMod::mint_to(admin, user_addr, 1_000_000);

        tap_market::init_market<TestCoin>(
            admin,
            /* num_price_buckets */ 21,
            /* mid_price_bucket */ 10,
            /* time_bucket_seconds */ 10,
            /* max_expiry_buckets_ahead */ 20,
            /* locked_columns_ahead */ 1,
            /* min_bet_size */ 10,
            /* max_bet_size */ 1_000_000_000,
            /* max_open_bets_per_user */ 10,
            100_000_000,
            false,
            10_000,
            false,
            b"",
            100_000_000,
        );

        let now = timestamp::now_seconds();
        let expiry_ts = now + 40;

        // stake_amount = 1 < min_bet_size, should abort
        tap_market::place_bet<TestCoin>(
            user,
            admin_addr,
            1,            // too small
            10,           // any valid bucket
            expiry_ts,
        );
    }

    //
    // 3) Betting inside locked columns must abort
    //
    #[test(aptos_framework = @aptos_framework, admin = @tap_market, user = @0x102)]
    #[expected_failure]
    public entry fun test_locked_columns_rejected(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        timestamp::set_time_has_started_for_testing(aptos_framework);

        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);

        account::create_account_for_test(admin_addr);
        account::create_account_for_test(user_addr);

        TestCoinMod::init(admin);
        TestCoinMod::register(admin);
        TestCoinMod::register(user);
        TestCoinMod::mint_to(admin, user_addr, 1_000_000);

        let num_price_buckets: u8 = 21;
        let mid_price_bucket: u8 = 10;
        let time_bucket_seconds: u64 = 10;
        let max_expiry_buckets_ahead: u64 = 20;
        let locked_columns_ahead: u64 = 1;
        let min_bet_size: u64 = 10;
        let max_bet_size: u64 = 1_000_000_000;
        let max_open_bets_per_user: u64 = 10;

        tap_market::init_market<TestCoin>(
            admin,
            num_price_buckets,
            mid_price_bucket,
            time_bucket_seconds,
            max_expiry_buckets_ahead,
            locked_columns_ahead,
            min_bet_size,
            max_bet_size,
            max_open_bets_per_user,
            100_000_000,
            false,
            10_000,
            false,
            b"",
            100_000_000,
        );

        let now = timestamp::now_seconds();
        let current_bucket = now / time_bucket_seconds;

        // Choose an expiry bucket that is exactly within the locked region:
        // expiry_bucket = current_bucket + locked_columns_ahead
        let forbidden_bucket = current_bucket + locked_columns_ahead;
        let expiry_ts = forbidden_bucket * time_bucket_seconds;

        tap_market::place_bet<TestCoin>(
            user,
            admin_addr,
            100,
            mid_price_bucket,
            expiry_ts,
        );
    }
}
