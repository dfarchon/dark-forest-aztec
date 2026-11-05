// L-04: find is open only while time is strictly before token_mint_end_timestamp.
use ::libs::artifact_utils::assert_token_mint_open;

global END: u64 = 1_798_761_600;

#[test]
unconstrained fn find_is_open_before_mint_end() {
    assert_token_mint_open(0, END);
    assert_token_mint_open(END - 1, END);
}

#[test(should_fail_with = "Token mint period has ended")]
unconstrained fn find_is_closed_at_mint_end() {
    assert_token_mint_open(END, END);
}

#[test(should_fail_with = "Token mint period has ended")]
unconstrained fn find_is_closed_after_mint_end() {
    // The public timestamp may lag the block by up to 300 seconds.
    assert_token_mint_open(END + 300, END);
}
