import { getAccessToken, zohoApi } from './utils/zohoAuth.js';

const getThreeMonthsAgoDate = () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date;
};

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

        // 1. Fetch Contact Details to check uploaded documents & owner/salesperson info
        const contactRes = await api.get(`/contacts/${customerId}`);
        const contact = contactRes.data.contact || {};
        
        const documents = contact.documents || [];
        const threeMonthsAgo = getThreeMonthsAgoDate();

        const hasRecentConfirmation = documents.some(doc => {
            const datePart = doc.uploaded_on ? doc.uploaded_on.split(' ')[0] : '';
            const [day, month, year] = datePart.split('-');
            if (!day || !month || !year) return false;

            const docDate = new Date(`${year}-${month}-${day}`);
            return docDate >= threeMonthsAgo;
        });

        if (!hasRecentConfirmation) {
            return res.status(403).json({ 
                error: 'Order Blocked: Please upload your mandatory quarterly ledger confirmation document in the Ledger section first.' 
            });
        }

        // 2. Create Sales Order Payload with Salesperson
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
