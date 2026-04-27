from unittest.mock import MagicMock, patch

from app.integrations.myob.order_import_batch import import_all_myob_sale_orders, import_myob_sale_orders_list_page


def test_import_batch_skips_row_without_uri_or_uid():
    db = MagicMock()
    with patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list:
        m_list.return_value = {
            "request_url": "https://api.myob.com/.../Sale/Order?$top=50&$skip=0",
            "top": 50,
            "skip": 0,
            "myob": {
                "Items": [
                    {"Nope": "x"},
                ]
            },
        }
        out = import_myob_sale_orders_list_page(db, top=50, skip=0)
    assert out["imported"] == 0
    assert out["failed"] == 1
    assert out["errors"][0]["error"] == "List row has no URI or UID."
    m_list.assert_called_once_with(db, top=50, skip=0)


def test_import_batch_one_success():
    db = MagicMock()
    with (
        patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list,
        patch("app.integrations.myob.order_import_batch.fetch_sale_order_detail_readonly") as m_det,
        patch("app.integrations.myob.order_import_batch.import_one_myob_sale_order") as m_one,
    ):
        m_list.return_value = {
            "request_url": "u",
            "top": 1,
            "skip": 0,
            "myob": {
                "Items": [
                    {"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "Number": "SO-1"},
                ]
            },
        }
        m_det.return_value = {"myob": {"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}
        m_one.return_value = {
            "ok": True,
            "order_id": "ord-1",
            "myob_order_uid": "uid",
            "myob_all_job_sheets_entered": True,
            "lines_synced": 1,
        }
        out = import_myob_sale_orders_list_page(db, top=1, skip=0)
    assert out["ok"] is True
    assert out["imported"] == 1
    assert out["failed"] == 0
    assert out["results"][0]["order_id"] == "ord-1"
    m_det.assert_called_once()
    m_one.assert_called_once()


def test_import_batch_counts_skipped_credit_note_like_orders():
    db = MagicMock()
    with (
        patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list,
        patch("app.integrations.myob.order_import_batch.fetch_sale_order_detail_readonly") as m_det,
        patch("app.integrations.myob.order_import_batch.import_one_myob_sale_order") as m_one,
    ):
        m_list.return_value = {
            "request_url": "u",
            "top": 1,
            "skip": 0,
            "myob": {"Items": [{"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "Number": "CR-1"}]},
        }
        m_det.return_value = {"myob": {"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}
        m_one.return_value = {
            "ok": True,
            "skipped": True,
            "skip_reason": "credit_note_like_order",
            "myob_order_uid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "lines_synced": 0,
        }
        out = import_myob_sale_orders_list_page(db, top=1, skip=0)
    assert out["ok"] is True
    assert out["imported"] == 0
    assert out["skipped"] == 1
    assert out["failed"] == 0
    assert out["skipped_results"][0]["skip_reason"] == "credit_note_like_order"


def test_import_all_follows_next_page_link():
    db = MagicMock()
    page2 = "https://api.myob.com/accountright/cf-1/Sale/Order?$skiptoken=z"
    with (
        patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list,
        patch("app.integrations.myob.order_import_batch.fetch_myob_url_readonly") as m_url,
        patch("app.integrations.myob.order_import_batch.fetch_sale_order_detail_readonly") as m_det,
        patch("app.integrations.myob.order_import_batch.import_one_myob_sale_order") as m_one,
    ):
        m_list.return_value = {
            "request_url": "https://api.myob.com/accountright/cf-1/Sale/Order?$top=1&$skip=0",
            "top": 1,
            "skip": 0,
            "myob": {
                "Items": [{"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}],
                "NextPageLink": page2,
            },
        }
        m_url.return_value = {
            "request_url": page2,
            "myob": {"Items": [{"UID": "bbbbbbbb-cccc-dddd-eeee-ffffffffffffffff"}]},
        }
        m_det.return_value = {"myob": {"UID": "stub"}}
        m_one.return_value = {"ok": True, "order_id": "o"}
        out = import_all_myob_sale_orders(db, top=1)
    assert out["pages_fetched"] == 2
    assert out["imported"] == 2
    assert out["truncated"] is False
    m_list.assert_called_once_with(db, top=1, skip=0)
    m_url.assert_called_once_with(db, url=page2)


def test_import_all_uses_skip_when_no_next_link_and_full_page():
    db = MagicMock()
    uid1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    uid2 = "bbbbbbbb-cccc-dddd-eeee-ffffffffffffffff"

    def list_side_effect(*_args, **kwargs):
        skip = kwargs.get("skip", 0)
        if skip == 0:
            return {
                "request_url": f"https://api.myob.com/...?$top=1&$skip=0",
                "top": 1,
                "skip": 0,
                "myob": {"Items": [{"UID": uid1}]},
            }
        if skip == 1:
            return {
                "request_url": f"https://api.myob.com/...?$top=1&$skip=1",
                "top": 1,
                "skip": 1,
                "myob": {"Items": [{"UID": uid2}]},
            }
        return {
            "request_url": f"https://api.myob.com/...?$top=1&$skip={skip}",
            "top": 1,
            "skip": skip,
            "myob": {"Items": []},
        }

    with (
        patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list,
        patch("app.integrations.myob.order_import_batch.fetch_myob_url_readonly") as m_url,
        patch("app.integrations.myob.order_import_batch.fetch_sale_order_detail_readonly") as m_det,
        patch("app.integrations.myob.order_import_batch.import_one_myob_sale_order") as m_one,
    ):
        m_list.side_effect = list_side_effect
        m_det.return_value = {"myob": {"UID": "stub"}}
        m_one.return_value = {"ok": True, "order_id": "o"}
        out = import_all_myob_sale_orders(db, top=1)
    assert m_url.call_count == 0
    assert m_list.call_count == 3
    assert out["pages_fetched"] == 2
    assert out["imported"] == 2


def test_import_all_truncated_when_page_cap_reached():
    db = MagicMock()
    with (
        patch("app.integrations.myob.order_import_batch.MYOB_SALE_ORDER_IMPORT_MAX_PAGES", 1),
        patch("app.integrations.myob.order_import_batch.fetch_sale_orders_list_readonly") as m_list,
        patch("app.integrations.myob.order_import_batch.fetch_myob_url_readonly") as m_url,
        patch("app.integrations.myob.order_import_batch.fetch_sale_order_detail_readonly") as m_det,
        patch("app.integrations.myob.order_import_batch.import_one_myob_sale_order") as m_one,
    ):
        m_list.return_value = {
            "request_url": "u",
            "top": 10,
            "skip": 0,
            "myob": {
                "Items": [{"UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}],
                "NextPageLink": "https://api.myob.com/accountright/cf/Sale/Order?page=2",
            },
        }
        m_det.return_value = {"myob": {"UID": "stub"}}
        m_one.return_value = {"ok": True, "order_id": "o"}
        out = import_all_myob_sale_orders(db, top=10)
    assert out["pages_fetched"] == 1
    assert out["truncated"] is True
    m_url.assert_not_called()
