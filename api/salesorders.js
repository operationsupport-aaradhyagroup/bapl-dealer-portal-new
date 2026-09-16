import { getAccessToken, zohoApi } from './utils/zohoAuth.js';

const BALANCE_CONFIRMATION_MODULE = 'cm_balance_confirmation';
const LEDGER_FIELD = 'cf_cm_all_ledgers_details';

async function resolveContactId(api, customerIdentifier) {
    const value = String(customerIdentifier || '').trim();
    if (!value) return null;
    if (/^\d{15,}$/.test(value)) return value;

    const response = await api.get('/contacts', {
        params: { contact_number: value, per_page: 200 },
    });
    const contact = (response.data.contacts || []).find(
        (item) => String(item.contact_number) === value
    );
    return contact?.contact_id || null;
}

function latestLedgerRow(rows) {
    return [...rows].sort((first, second) => {
        const firstDate = first.cf_period_to || first.cf_period_from || '';
        const secondDate = second.cf_period_to || second.cf_period_from || '';
        return String(secondDate).localeCompare(String(firstDate));
    })[0];
}

async function hasUploadedLatestBalanceConfirmation(api, customerId) {
    const listResponse = await api.get(`/${BALANCE_CONFIRMATION_MODULE}`, {
        params: { per_page: 200 },
    });
    const latestConfirmation = (listResponse.data.module_records || [])
        .filter((record) => String(record.cf_customers) === String(customerId))
        .sort((first, second) => new Date(second.last_modified_time || 0) - new Date(first.last_modified_time || 0))[0];

    if (!latestConfirmation?.module_record_id) return false;

    const detailResponse = await api.get(
        `/${BALANCE_CONFIRMATION_MODULE}/${latestConfirmation.module_record_id}`
    );
    const confirmation = detailResponse.data.module_record_hash || {};
    const latestRow = latestLedgerRow(confirmation[LEDGER_FIELD] || []);

    return Boolean(latestRow?.cf_ledger_upload);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const customerIdentifier = req.headers['x-customer-id'];

        if (!customerIdentifier) {
            return res.status(400).json({ error: 'Customer ID missing in headers.' });
        }

        const token = await getAccessToken();
        const api = await zohoApi(token);
        const pricebookId = '2858789000000607355';
        const customerId = await resolveContactId(api, customerIdentifier);
        if (!customerId) {
            return res.status(404).json({ error: 'No Zoho Books customer matches this customer number.' });
        }

        // A dealer must upload the ledger for their newest Balance Confirmation
        // period before creating another sales order. Checking the confirmation row
        // (rather than any contact document) prevents unrelated uploads from bypassing this rule.
        if (!await hasUploadedLatestBalanceConfirmation(api, customerId)) {
            return res.status(403).json({ 
                error: 'Order Blocked: Upload the ledger for your latest Balance Confirmation period before placing an order.'
            });
        }

        // Create Sales Order Payload with Salesperson
        const contactRes = await api.get(`/contacts/${customerId}`);
        const contact = contactRes.data.contact || {};
        const { cartItems } = req.body;
        if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart items are missing or invalid.' });
        }

        const line_items = cartItems.map(item => ({
            item_id: item.item_id,
            quantity: item.quantity,
            rate: item.rate
        }));

        const salesOrderData = {
            customer_id: customerId,
            line_items: line_items,
            pricebook_id: pricebookId,
            salesperson_name: contact.owner_name || "Admin" // Zoho ke liye mandatory salesperson field
        };

        const response = await api.post('/salesorders', salesOrderData);

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('Sales order request failed:', error.response?.data?.message || error.message);
        
        const errDetail = error.response?.data?.message || error.response?.data || error.message;
        return res.status(500).json({ error: errDetail });
    }
}
