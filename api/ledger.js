import { getAccessToken, zohoApi } from './utils/zohoAuth.js';
import FormData from 'form-data';
import formidable from 'formidable';
import fs from 'fs';

// Vercel par body parsing disable karni padti hai file uploads ke liye
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const customerId = req.headers['x-customer-id'];
    console.log("DEBUG LEDGER - Customer ID received:", customerId);

    if (!customerId) {
        return res.status(400).json({ error: 'Customer ID missing in headers.' });
    }

    const form = formidable({});

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Formidable parse error:', err);
            return res.status(500).json({ error: 'Error parsing uploaded file.' });
        }

        const uploadedFile = files.document?.[0] || files.document;
        if (!uploadedFile) {
            console.error('No file found in request files object:', files);
            return res.status(400).json({ error: 'Ledger confirmation document is mandatory!' });
        }

        console.log("DEBUG LEDGER - File parsed successfully:", uploadedFile.originalFilename, "Path:", uploadedFile.filepath);

        try {
            const token = await getAccessToken();
            const api = await zohoApi(token);

            const zohoForm = new FormData();
            // Zoho Books API strictly expects 'attachment' as the form-data field name for contact documents
            zohoForm.append('attachment', fs.createReadStream(uploadedFile.filepath), {
                filename: uploadedFile.originalFilename || 'ledger_confirmation.png',
                contentType: uploadedFile.mimetype || 'image/png'
            });

            console.log(`Uploading ledger attachment to Zoho for customer: ${customerId}`);
            
            // Zoho Books API endpoint with explicit organization_id parameter
            await api.post(`/contacts/${customerId}/attachment`, zohoForm, {
                params: {
                    organization_id: process.env.ZOHO_ORG_ID
                },
                headers: {
                    ...zohoForm.getHeaders(),
                    'Content-Type': undefined
                }
            });

            // Cleanup temp file
            if (uploadedFile.filepath && fs.existsSync(uploadedFile.filepath)) {
                fs.unlinkSync(uploadedFile.filepath);
            }

            console.log("DEBUG LEDGER - File uploaded successfully to Zoho!");
            return res.status(200).json({ success: true, message: 'Confirmation document uploaded to Zoho successfully!' });
        } catch (error) {
            console.error('=== ZOHO UPLOAD ERROR DEBUG ===');
            if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('Error Message:', error.message);
            }
            console.error('===============================');

            const zohoErrorMessage = error.response?.data?.message || error.response?.data || error.message;
            return res.status(500).json({ error: zohoErrorMessage });
        }
    });
}