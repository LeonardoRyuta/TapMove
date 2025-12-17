#[test_only]
module tap_market::test_coin {
    use std::string;
    use std::signer;
    use aptos_framework::coin;

    /// Simple test coin type
    struct TestCoin has store {}

    /// Caps for minting / burning TestCoin, stored under the admin
    struct Caps has key {
        burn_cap: coin::BurnCapability<TestCoin>,
        freeze_cap: coin::FreezeCapability<TestCoin>,
        mint_cap: coin::MintCapability<TestCoin>,
    }

    /// Initialize TestCoin.
    /// IMPORTANT: must be called with a signer whose address is the same
    /// as this module's address (in tests we’ll use `admin = @tap_market`).
    public entry fun init(admin: &signer) {
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<TestCoin>(
            admin,
            string::utf8(b"Test Coin"),
            string::utf8(b"TCOIN"),
            6,      // decimals
            true,   // monitor_supply
        );

        move_to(
            admin,
            Caps { burn_cap, freeze_cap, mint_cap },
        );
    }

    /// Mint TestCoin to `recipient`. Only callable by the admin (holder of Caps).
    public entry fun mint_to(
        admin: &signer,
        recipient: address,
        amount: u64,
    ) acquires Caps {
        let caps = borrow_global<Caps>(signer::address_of(admin));
        let coins = coin::mint<TestCoin>(amount, &caps.mint_cap);
        coin::deposit(recipient, coins);
    }

    /// Register a CoinStore<TestCoin> for `account` so it can hold TestCoin.
    public entry fun register(account: &signer) {
        coin::register<TestCoin>(account);
    }
}
