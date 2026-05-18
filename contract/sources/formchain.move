module formchain::formchain {

    use std::string::{Self, String};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::dynamic_field;
    use sui::table::{Self, Table};

    const MAX_TITLE_LEN: u64       = 120;
    const MAX_DESC_LEN: u64        = 500;
    const MAX_BLOB_ID_LEN: u64     = 128;
    const MAX_NOTE_LEN: u64        = 1000;

    const PRIORITY_NONE: u8   = 0;
    const PRIORITY_LOW: u8    = 1;
    const PRIORITY_MEDIUM: u8 = 2;
    const PRIORITY_HIGH: u8   = 3;

    const ENotOwner: u64           = 1;
    const EFormNotPublished: u64   = 2;
    const EFormPaused: u64         = 3;
    const ETitleTooLong: u64       = 4;
    const EDescTooLong: u64        = 5;
    const EBlobIdEmpty: u64        = 6;
    const EBlobIdTooLong: u64      = 7;
    const ENoteTooLong: u64        = 8;
    const EInvalidPriority: u64    = 9;
    const EResponseNotFound: u64   = 10;
    const EAlreadyPublished: u64   = 11;

    public struct FormRegistry has key {
        id: UID,
        total_forms: u64,
        total_responses: u64,
    }

    /// Mỗi Form là một shared object độc lập
    /// Walrus blob_id của config form được lưu ở đây
    public struct Form has key {
        id: UID,

        /// Blob ID trên Walrus chứa toàn bộ cấu hình form
        config_blob_id: String,
        title: String,
        description: String,

        /// Ví tạo form
        owner: address,

        /// Form có bật mã hóa Seal không
        seal_encrypted: bool,

        /// Policy ID của Seal (nếu seal_encrypted = true)
        /// Frontend dùng để giải mã response khi admin xem
        seal_policy_id: Option<String>,

        /// Trạng thái
        published: bool,
        paused: bool,

        /// Timestamps
        created_at: u64,
        updated_at: u64,

        /// Đếm tổng response
        response_count: u64,

        /// Danh sách Response lưu dạng Table
        responses: Table<u64, ResponseRecord>,
    }

    /// Record mỗi lần người dùng submit form
    public struct ResponseRecord has store {
        index: u64,

        /// Blob ID trên Walrus chứa dữ liệu response
        /// Nếu form.seal_encrypted = true -> blob này đã được mã hóa bởi Seal
        blob_id: String,

        /// Ví gửi response
        submitter: address,

        /// Timestamp submit (ms)
        submitted_at: u64,

        /// Admin gán sau khi review
        priority: u8,

        /// Ghi chú của admin (lưu blob_id của note trên Walrus, hoặc text ngắn)
        note: String,
    }

    /// Capability – chứng minh quyền sở hữu Form.
    /// Được gửi vào ví người tạo form.
    /// Dùng để: xóa form, pause/unpublish, gán priority/note cho response.
    public struct FormOwnerCap has key, store {
        id: UID,
        form_id: ID,
        owner: address,
    }

    public struct FormCreated has copy, drop {
        form_id: ID,
        owner: address,
        config_blob_id: String,
        seal_encrypted: bool,
        timestamp: u64,
    }

    public struct FormPublished has copy, drop {
        form_id: ID,
        owner: address,
        timestamp: u64,
    }

    public struct FormPaused has copy, drop {
        form_id: ID,
        paused: bool,
        timestamp: u64,
    }

    public struct FormDeleted has copy, drop {
        form_id: ID,
        owner: address,
        timestamp: u64,
    }

    public struct FormConfigUpdated has copy, drop {
        form_id: ID,
        new_blob_id: String,
        timestamp: u64,
    }

    public struct ResponseSubmitted has copy, drop {
        form_id: ID,
        response_index: u64,
        blob_id: String,
        submitter: address,
        seal_encrypted: bool,
        timestamp: u64,
    }

    public struct ResponseAnnotated has copy, drop {
        form_id: ID,
        response_index: u64,
        priority: u8,
        timestamp: u64,
    }

    fun init(ctx: &mut TxContext) {
        // Tạo FormRegistry shared object duy nhất
        let registry = FormRegistry {
            id: object::new(ctx),
            total_forms: 0,
            total_responses: 0,
        };
        transfer::share_object(registry);
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    public entry fun create_form(
        registry: &mut FormRegistry,
        config_blob_id: vector<u8>,
        title: vector<u8>,
        description: vector<u8>,
        seal_encrypted: bool,
        seal_policy_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let title_str = string::utf8(title);
        let desc_str = string::utf8(description);
        let blob_str = string::utf8(config_blob_id);

        assert!(string::length(&title_str) <= MAX_TITLE_LEN, ETitleTooLong);
        assert!(string::length(&desc_str) <= MAX_DESC_LEN, EDescTooLong);
        assert!(string::length(&blob_str) > 0, EBlobIdEmpty);
        assert!(string::length(&blob_str) <= MAX_BLOB_ID_LEN, EBlobIdTooLong);

        let owner = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);

        let seal_policy = if (seal_encrypted && !vector::is_empty(&seal_policy_id)) {
            option::some(string::utf8(seal_policy_id))
        } else {
            option::none()
        };

        let form_uid = object::new(ctx);
        let form_id = object::uid_to_inner(&form_uid);

        let form = Form {
            id: form_uid,
            config_blob_id: blob_str,
            title: title_str,
            description: desc_str,
            owner,
            seal_encrypted,
            seal_policy_id: seal_policy,
            published: false,
            paused: false,
            created_at: now,
            updated_at: now,
            response_count: 0,
            responses: table::new(ctx),
        };

        // Cấp FormOwnerCap cho người tạo
        let cap = FormOwnerCap {
            id: object::new(ctx),
            form_id,
            owner,
        };

        // Cập nhật registry
        registry.total_forms = registry.total_forms + 1;

        let owner_key = owner;
        if (dynamic_field::exists_(&registry.id, owner_key)) {
            let list: &mut vector<ID> = dynamic_field::borrow_mut(&mut registry.id, owner_key);
            vector::push_back(list, form_id);
        } else {
            let mut list = vector::empty<ID>();
            vector::push_back(&mut list, form_id);
            dynamic_field::add(&mut registry.id, owner_key, list);
        };

        event::emit(FormCreated {
            form_id,
            owner,
            config_blob_id: blob_str,
            seal_encrypted,
            timestamp: now,
        });

        transfer::share_object(form);
        transfer::transfer(cap, owner);
    }

    /// Publish form
    /// Chỉ owner mới được gọi.
    public entry fun publish_form(
        cap: &FormOwnerCap,
        form: &mut Form,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_owner(cap, form, ctx);
        assert!(!form.published, EAlreadyPublished);
        form.published = true;
        form.updated_at = clock::timestamp_ms(clock);

        event::emit(FormPublished {
            form_id: object::id(form),
            owner: form.owner,
            timestamp: form.updated_at,
        });
    }

    /// Pause / unpause nhận response (không xóa form).
    public entry fun set_paused(
        cap: &FormOwnerCap,
        form: &mut Form,
        paused: bool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_owner(cap, form, ctx);
        form.paused = paused;
        form.updated_at = clock::timestamp_ms(clock);

        event::emit(FormPaused {
            form_id: object::id(form),
            paused,
            timestamp: form.updated_at,
        });
    }

    /// Cập nhật config blob khi chủ form sửa cấu trúc form
    public entry fun update_config(
        cap: &FormOwnerCap,
        form: &mut Form,
        new_config_blob_id: vector<u8>,
        new_title: vector<u8>,
        new_description: vector<u8>,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_owner(cap, form, ctx);

        let blob_str = string::utf8(new_config_blob_id);
        let title_str = string::utf8(new_title);
        let desc_str = string::utf8(new_description);

        assert!(string::length(&blob_str) > 0, EBlobIdEmpty);
        assert!(string::length(&blob_str) <= MAX_BLOB_ID_LEN, EBlobIdTooLong);
        assert!(string::length(&title_str) <= MAX_TITLE_LEN, ETitleTooLong);
        assert!(string::length(&desc_str) <= MAX_DESC_LEN, EDescTooLong);

        form.config_blob_id = blob_str;
        form.title = title_str;
        form.description = desc_str;
        form.updated_at = clock::timestamp_ms(clock);

        event::emit(FormConfigUpdated {
            form_id: object::id(form),
            new_blob_id: blob_str,
            timestamp: form.updated_at,
        });
    }

    /// Xóa form: burn Form object + FormOwnerCap
    public entry fun delete_form(
        cap: FormOwnerCap,
        form: Form,
        registry: &mut FormRegistry,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(cap.owner == sender, ENotOwner);
        assert!(cap.form_id == object::id(&form), ENotOwner);

        let now = clock::timestamp_ms(clock);
        let form_id = object::id(&form);
        let owner = form.owner;

        // Xóa khỏi registry
        if (dynamic_field::exists_(&registry.id, owner)) {
            let list: &mut vector<ID> = dynamic_field::borrow_mut(&mut registry.id, owner);
            let (found, idx) = vector::index_of(list, &form_id);
            if (found) {
                vector::remove(list, idx);
            };
        };

        if (registry.total_forms > 0) {
            registry.total_forms = registry.total_forms - 1;
        };

        event::emit(FormDeleted { form_id, owner, timestamp: now });

        // Burn objects
        let FormOwnerCap { id: cap_uid, form_id: _, owner: _ } = cap;
        object::delete(cap_uid);

        let Form {
            id: form_uid,
            config_blob_id: _,
            title: _,
            description: _,
            owner: _,
            seal_encrypted: _,
            seal_policy_id: _,
            published: _,
            paused: _,
            created_at: _,
            updated_at: _,
            response_count: _,
            responses,
        } = form;
        table::destroy_empty(responses);
        object::delete(form_uid);
    }

    public entry fun submit_response(
        form: &mut Form,
        registry: &mut FormRegistry,
        blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(form.published, EFormNotPublished);
        assert!(!form.paused, EFormPaused);

        let blob_str = string::utf8(blob_id);
        assert!(string::length(&blob_str) > 0, EBlobIdEmpty);
        assert!(string::length(&blob_str) <= MAX_BLOB_ID_LEN, EBlobIdTooLong);

        let submitter = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        let response_index = form.response_count;

        let record = ResponseRecord {
            index: response_index,
            blob_id: blob_str,
            submitter,
            submitted_at: now,
            priority: PRIORITY_NONE,
            note: string::utf8(b""),
        };

        table::add(&mut form.responses, response_index, record);
        form.response_count = form.response_count + 1;
        registry.total_responses = registry.total_responses + 1;

        event::emit(ResponseSubmitted {
            form_id: object::id(form),
            response_index,
            blob_id: blob_str,
            submitter,
            seal_encrypted: form.seal_encrypted,
            timestamp: now,
        });
    }

    public entry fun annotate_response(
        cap: &FormOwnerCap,
        form: &mut Form,
        response_index: u64,
        priority: u8,
        note: vector<u8>,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_owner(cap, form, ctx);
        assert!(priority <= PRIORITY_HIGH, EInvalidPriority);
        assert!(response_index < form.response_count, EResponseNotFound);

        let note_str = string::utf8(note);
        assert!(string::length(&note_str) <= MAX_NOTE_LEN, ENoteTooLong);

        let record = table::borrow_mut(&mut form.responses, response_index);
        record.priority = priority;
        record.note = note_str;

        form.updated_at = clock::timestamp_ms(clock);

        event::emit(ResponseAnnotated {
            form_id: object::id(form),
            response_index,
            priority,
            timestamp: form.updated_at,
        });
    }

    /// Trả về Table responses của form
    public fun get_responses(form: &Form): &Table<u64, ResponseRecord> {
        &form.responses
    }

    /// Trả về metadata cơ bản của form
    public fun get_form_info(form: &Form): (String, String, address, bool, bool, bool, u64, u64) {
        (
            form.title,
            form.config_blob_id,
            form.owner,
            form.seal_encrypted,
            form.published,
            form.paused,
            form.response_count,
            form.created_at,
        )
    }

    /// Lấy blob_id của 1 response theo index
    public fun get_response_blob(form: &Form, index: u64): (String, address, u64, u8, String) {
        assert!(index < form.response_count, EResponseNotFound);
        let r = table::borrow(&form.responses, index);
        (r.blob_id, r.submitter, r.submitted_at, r.priority, r.note)
    }

    /// Lấy danh sách form_id mà owner đã tạo
    public fun get_owner_forms(registry: &FormRegistry, owner: address): vector<ID> {
        if (dynamic_field::exists_(&registry.id, owner)) {
            *dynamic_field::borrow<address, vector<ID>>(&registry.id, owner)
        } else {
            vector::empty()
        }
    }

    /// Thống kê toàn bộ platform
    public fun get_stats(registry: &FormRegistry): (u64, u64) {
        (registry.total_forms, registry.total_responses)
    }

    /// Kiểm tra seal policy của form
    public fun get_seal_policy(form: &Form): Option<String> {
        form.seal_policy_id
    }

    fun assert_owner(cap: &FormOwnerCap, form: &Form, ctx: &TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(cap.owner == sender, ENotOwner);
        assert!(cap.form_id == object::id(form), ENotOwner);
    }


    public fun record_blob_id(r: &ResponseRecord): String { r.blob_id }
    public fun record_submitter(r: &ResponseRecord): address { r.submitter }
    public fun record_priority(r: &ResponseRecord): u8 { r.priority }
    public fun record_note(r: &ResponseRecord): String { r.note }
    public fun record_index(r: &ResponseRecord): u64 { r.index }

    public fun cap_owner(cap: &FormOwnerCap): address { cap.owner }
    public fun cap_form_id(cap: &FormOwnerCap): ID { cap.form_id }
}
