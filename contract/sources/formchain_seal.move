module formchain::formchain_seal {

    use formchain::formchain::{FormOwnerCap, Form, cap_owner, cap_form_id};
    use sui::object;

    public entry fun seal_approve(
        _id: vector<u8>,
        cap: &FormOwnerCap,
        form: &Form,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        // Người gọi phải là chủ của cap
        assert!(cap_owner(cap) == sender, 1);
        // Cap phải được cấp đúng cho form đang truy cập
        assert!(cap_form_id(cap) == object::id(form), 1);
    }
}
