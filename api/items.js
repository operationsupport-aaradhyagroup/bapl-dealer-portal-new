import { getAccessToken, zohoApi } from './utils/zohoAuth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const token = await getAccessToken();
        const api = await zohoApi(token);
        
        // Aapki di gayi Default Price List ID
        const pricebookId = '2858789000000607355';

        // 1. Ek sath Items aur Pricebook fetch karna
        const [itemsRes, pricebookRes] = await Promise.all([
            api.get('/items'),
            api.get(`/pricebooks/${pricebookId}`)
        ]);

        const allItems = itemsRes.data.items || [];
        const pricebookItems = pricebookRes.data.pricebook?.pricebook_items || [];

        // 2. Pricebook rates ka map banana
        const customRates = {};
        pricebookItems.forEach(pbItem => {
            customRates[pbItem.item_id] = pbItem.pricebook_rate;
        });

        // 3. Items ke sath price list ke rates, SKU aur Name ko map karna
        const formattedItems = allItems
            .filter(item => item.status === 'active' && item.can_be_sold)
            .map(item => ({
                item_id: item.item_id,
                name: item.name,
                sku: item.sku || 'N/A',
                rate: customRates[item.item_id] !== undefined ? customRates[item.item_id] : (item.rate || 0)
            }));

        return res.status(200).json({ items: formattedItems });
    } catch (error) {
        console.error('Error fetching items catalog:', error.response?.data || error.message);
        return res.status(500).json({ 
            error: error.response?.data?.message || 'Failed to fetch items' 
        });
    }
}