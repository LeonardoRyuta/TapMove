module tap_market::init_eth_market {
    use std::signer;
    use aptos_framework::aptos_coin::AptosCoin;
    use tap_market::tap_market;

    /// One-click initializer for an ETH/USD market
    /// Bets are denominated in AptosCoin / MOVE.
    public entry fun init_eth_usd_market(admin: &signer) {
        // ---- grid config ----
        let num_price_buckets: u8 = 21;      // 10 below, 1 mid, 10 above
        let mid_price_bucket: u8 = 10;       // center row

        // each time column = 5s
        let time_bucket_seconds: u64 = 5;
        let max_expiry_buckets_ahead: u64 = 20; // can bet up to 100s out
        let locked_columns_ahead: u64 = 1;      // lock current + next column

        // ---- bet sizing (in octas of MOVE) ----
        let min_bet_size: u64 = 100_000;       // 0.001 MOVE
        let max_bet_size: u64 = 10_000_000;    // 0.10 MOVE
        let max_open_bets_per_user: u64 = 20;

        // ---- price → bucket mapping ----
        //
        // Pyth ETH/USD has exponent -8. So 3000.00 USD ≈ 3000 * 10^8.
        let anchor_price_magnitude: u64 = 3_000_00000000; // 3000 * 1e8
        let anchor_price_negative: bool = false;

        // one vertical bucket = 0.50 USD
        let bucket_size_magnitude: u64 = 50_000_000; // 0.50 * 1e8
        let bucket_size_negative: bool = false;

        // Pyth ETH/USD feed id (same everywhere; Aptos uses it without 0x prefix)
        // 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
        let price_feed_id = x"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

        // ---- initial house liquidity (MOVE) ----
        let initial_house_liquidity_amount: u64 = 1_000_000_000; // 10.0 MOVE (assuming 8 decimals)

        tap_market::init_market<AptosCoin>(
            admin,
            num_price_buckets,
            mid_price_bucket,
            time_bucket_seconds,
            max_expiry_buckets_ahead,
            locked_columns_ahead,
            min_bet_size,
            max_bet_size,
            max_open_bets_per_user,
            anchor_price_magnitude,
            anchor_price_negative,
            bucket_size_magnitude,
            bucket_size_negative,
            price_feed_id,
            initial_house_liquidity_amount,
        );
    }
}
