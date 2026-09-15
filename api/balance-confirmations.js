import { getAccessToken, zohoApi } from './utils/zohoAuth.js';
import FormData from 'form-data';
import formidable from 'formidable';
import fs from 'node:fs';

const MODULE = 'cm_balance_confirmation';
const LEDGER_FIELD = 'cf_cm_all_ledgers_details';
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

export const config = {
    api: {
        bodyParser: false,
    },
};

function json(res, status, body) {
    return res.status(status).json(body);
}

function requestPath(req) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    return pathname.replace(/^\/api/, '').replace(/^\/balance-confirmations/, '') || '/';
}

function contactIdFromRequest(req) {
    // Production hosting must set this from its authenticated session, never from browser input.
    return req.auth?.zohoContactId || req.headers['x-customer-id'] || null;
}

async function resolveContactId(api, customerIdentifier) {
    const value = String(customerIdentifier || '').trim();
    if (!value) {
        const error = new Error('Customer number is required');
        error.status = 401;
        throw error;
    }

    // A Zoho contact ID is currently a long numeric ID. The portal otherwise accepts
    // the dealer-facing customer number, for example 8010336.
    if (/^\d{15,}$/.test(value)) return value;

    const response = await api.get('/contacts', {
        params: { contact_number: value, per_page: 200 },
    });
    const contact = (response.data.contacts || []).find(
        (item) => String(item.contact_number) === value
    );
    if (!contact?.contact_id) {
        const error = new Error('No Zoho Books customer matches this customer number');
        error.status = 404;
        throw error;
    }
    return String(contact.contact_id);
}

function cleanRow(row) {
    return Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith('_formatted')));
}

function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function ensureJsonBody(req) {
    if (req.body || !req.headers['content-type']?.includes('application/json')) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    req.body = body ? JSON.parse(body) : {};
}

function formField(fields, name) {
    const value = fields?.[name];
    return Array.isArray(value) ? value[0] : value;
}

function extensionOf(filename = '') {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function parseAttachment(req) {
    return new Promise((resolve, reject) => {
        formidable({ maxFileSize: MAX_ATTACHMENT_SIZE }).parse(req, (error, fields, files) => {
            if (error) return reject(error);
            resolve({
                fields,
                file: files.attachment?.[0] || files.attachment,
            });
        });
    });
}

function validateAttachment(file) {
    if (!file) {
        const error = new Error('Choose a PDF, JPG, JPEG, or PNG file first');
        error.status = 422;
        throw error;
    }
    const extension = extensionOf(file.originalFilename);
    if (file.size > MAX_ATTACHMENT_SIZE || !ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)
        || (file.mimetype && !ALLOWED_ATTACHMENT_TYPES.has(file.mimetype))) {
        const error = new Error('Only PDF, JPG, JPEG, and PNG files up to 10 MB are accepted');
        error.status = 422;
        throw error;
    }
}

async function uploadToCustomerDocuments(api, contactId, file) {
    const form = new FormData();
    form.append('attachment', fs.createReadStream(file.filepath), {
        filename: file.originalFilename || 'ledger-confirmation',
        contentType: file.mimetype || 'application/octet-stream',
    });
    const response = await api.post(`/contacts/${contactId}/attachment`, form, {
        headers: form.getHeaders(),
    });
    const documentId = response.data.document_id
        || response.data.document?.document_id
        || response.data.documents?.[0]?.document_id;
    if (!documentId) {
        throw new Error('Zoho Books uploaded the file but did not return a document ID');
    }
    return String(documentId);
}

function toPortalRecord(record) {
    const rows = record[LEDGER_FIELD] || [];
    return {
        module_record_id: record.module_record_id,
        record_name: record.record_name || record.cf_sno_formatted || record.cf_sno,
        customerNumber: record.cf_custom_number_formatted || record.cf_custom_number,
        created_time: record.created_time,
        last_modified_time: record.last_modified_time,
        ledgerDetails: rows.map((row, index) => ({
            rowId: String(index),
            periodFrom: row.cf_period_from,
            periodTo: row.cf_period_to,
            status: row.cf_status || 'Pending',
            approvalDate: row.cf_approval_date,
            rejectionReason: row.cf_rejection_reason,
            attachmentName: row.cf_ledger_upload_formatted || row.cf_ledger_upload || null,
            attachmentId: row.cf_ledger_upload || null,
        })),
    };
}

async function getRecordForDealer(api, recordId, contactId) {
    const response = await api.get(`/${MODULE}/${recordId}`);
    const record = response.data.module_record_hash;
    if (!record) {
        const error = new Error('Balance Confirmation not found');
        error.status = 404;
        throw error;
    }
    if (String(record.cf_customers) !== String(contactId)) {
        const error = new Error('Balance Confirmation does not belong to this customer');
        error.status = 403;
        throw error;
    }
    return record;
}

async function updateLedgerRow(api, record, rowId, changes) {
    const index = Number(rowId);
    const rows = record[LEDGER_FIELD] || [];
    if (!Number.isInteger(index) || !rows[index]) {
        const error = new Error('Ledger period not found');
        error.status = 404;
        throw error;
    }
    if (rows[index].cf_status === 'Approved') {
        const error = new Error('This ledger period is already approved');
        error.status = 409;
        throw error;
    }

    const updatedRows = rows.map((row, currentIndex) => cleanRow(
        currentIndex === index ? { ...row, ...changes } : row
    ));
    await api.put(`/${MODULE}/${record.module_record_id}`, { [LEDGER_FIELD]: updatedRows });
}

async function appendLedgerRow(api, record, row) {
    const rows = record[LEDGER_FIELD] || [];
    const duplicate = rows.some((existing) => (
        existing.cf_period_from === row.cf_period_from
        && existing.cf_period_to === row.cf_period_to
    ));
    if (duplicate) {
        const error = new Error('This ledger period already exists in the Balance Confirmation');
        error.status = 409;
        throw error;
    }
    await api.put(`/${MODULE}/${record.module_record_id}`, {
        [LEDGER_FIELD]: [...rows.map(cleanRow), row],
    });
}

export default async function handler(req, res) {
    const customerIdentifier = contactIdFromRequest(req);
    if (!customerIdentifier) return json(res, 401, { error: 'Not authenticated' });

    try {
        const api = await zohoApi(await getAccessToken());
        const contactId = await resolveContactId(api, customerIdentifier);
        const pathname = requestPath(req);
        const segments = pathname.split('/').filter(Boolean);
        await ensureJsonBody(req);

        if (req.method === 'GET' && segments.length === 0) {
            const response = await api.get(`/${MODULE}`, { params: { per_page: 200 } });
            const summaries = (response.data.module_records || [])
                .filter((record) => String(record.cf_customers) === String(contactId))
                .sort((first, second) => new Date(second.last_modified_time || 0) - new Date(first.last_modified_time || 0))
                .slice(0, 1);
            // List responses do not include custom-table rows, so retrieve each matching
            // record detail to show its period and Ledger Upload state in the portal.
            const records = await Promise.all(summaries.map(async (summary) => {
                try {
                    const detail = await getRecordForDealer(api, summary.module_record_id, contactId);
                    return toPortalRecord(detail);
                } catch {
                    return toPortalRecord(summary);
                }
            }));
            return json(res, 200, { records });
        }

        if (req.method === 'POST' && segments.length === 0) {
            const periodFrom = String(req.body?.periodFrom || '');
            const periodTo = String(req.body?.periodTo || '');
            if (!isDateOnly(periodFrom) || !isDateOnly(periodTo) || periodFrom > periodTo) {
                return json(res, 422, { error: 'Enter a valid period start and end date' });
            }

            const ledgerRow = {
                cf_period_from: periodFrom,
                cf_period_to: periodTo,
                cf_status: 'Pending',
                cf_portal_reference_id: `PORTAL-${Date.now()}`,
            };
            const existingSummaries = (await api.get(`/${MODULE}`, { params: { per_page: 200 } }))
                .data.module_records
                ?.filter((record) => String(record.cf_customers) === String(contactId))
                .sort((first, second) => new Date(second.last_modified_time || 0) - new Date(first.last_modified_time || 0)) || [];

            if (existingSummaries.length > 0) {
                const existing = await getRecordForDealer(api, existingSummaries[0].module_record_id, contactId);
                await appendLedgerRow(api, existing, ledgerRow);
                const updated = await getRecordForDealer(api, existing.module_record_id, contactId);
                return json(res, 200, { record: toPortalRecord(updated), appended: true });
            }

            const customerNumber = Number(customerIdentifier);
            const payload = {
                cf_custom_number: Number.isFinite(customerNumber) ? customerNumber : customerIdentifier,
                cf_customers: contactId,
                [LEDGER_FIELD]: [ledgerRow],
            };
            const createdResponse = await api.post(`/${MODULE}`, payload);
            const createdId = createdResponse.data.module_record?.module_record_id
                || createdResponse.data.module_record_id;
            if (!createdId) {
                throw new Error('Zoho Books did not return the new Balance Confirmation ID');
            }
            const created = await getRecordForDealer(api, createdId, contactId);
            return json(res, 201, { record: toPortalRecord(created) });
        }

        const [recordId, action, documentId] = segments;
        if (!recordId) return json(res, 404, { error: 'Not found' });

        const record = await getRecordForDealer(api, recordId, contactId);

        if (req.method === 'GET' && !action) {
            return json(res, 200, { record: toPortalRecord(record) });
        }

        if (req.method === 'GET' && action === 'attachments' && documentId) {
            const ledgerRow = (record[LEDGER_FIELD] || []).find(
                (row) => String(row.cf_ledger_upload || '') === String(documentId)
            );
            if (!ledgerRow) {
                return json(res, 404, { error: 'Ledger attachment not found for this Balance Confirmation' });
            }

            const attachment = await api.get(`/contacts/${contactId}/documents/${documentId}`, {
                responseType: 'arraybuffer',
            });
            const filename = String(ledgerRow.cf_ledger_upload_formatted || 'ledger-upload')
                .replace(/[^a-zA-Z0-9._-]/g, '_');
            res.statusCode = 200;
            res.setHeader('Content-Type', attachment.headers['content-type'] || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            return res.end(Buffer.from(attachment.data));
        }

        if (req.method === 'POST' && action === 'approve') {
            const rowId = req.body?.rowId;
            await updateLedgerRow(api, record, rowId, {
                cf_status: 'Approved',
                cf_approval_date: new Date().toISOString().slice(0, 10),
                cf_rejection_reason: '',
            });
            const updated = await getRecordForDealer(api, recordId, contactId);
            return json(res, 200, { record: toPortalRecord(updated) });
        }

        if (req.method === 'POST' && action === 'reject') {
            const reason = req.body?.reason?.trim();
            if (!reason) return json(res, 422, { error: 'A rejection reason is required' });
            await updateLedgerRow(api, record, req.body?.rowId, {
                cf_status: 'Rejected',
                cf_rejection_reason: reason,
            });
            const updated = await getRecordForDealer(api, recordId, contactId);
            return json(res, 200, { record: toPortalRecord(updated) });
        }

        if (req.method === 'POST' && action === 'attachments' && !documentId) {
            let file;
            try {
                const parsed = await parseAttachment(req);
                file = parsed.file;
                validateAttachment(file);

                const rowId = formField(parsed.fields, 'rowId');
                // Validate the target row before uploading the file to Zoho Documents.
                const rowIndex = Number(rowId);
                const rows = record[LEDGER_FIELD] || [];
                if (!Number.isInteger(rowIndex) || !rows[rowIndex]) {
                    return json(res, 404, { error: 'Ledger period not found' });
                }
                if (rows[rowIndex].cf_status === 'Approved') {
                    return json(res, 409, { error: 'This ledger period is already approved' });
                }

                const documentId = await uploadToCustomerDocuments(api, contactId, file);
                await updateLedgerRow(api, record, rowId, { cf_ledger_upload: documentId });
                const updated = await getRecordForDealer(api, recordId, contactId);
                return json(res, 200, {
                    record: toPortalRecord(updated),
                    message: 'Ledger uploaded to the selected Balance Confirmation period.',
                });
            } finally {
                if (file?.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            }
        }

        return json(res, 404, { error: 'Not found' });
    } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        console.error('Balance Confirmation request failed:', error.response?.data?.message || error.message);
        return json(res, 502, { error: 'Zoho Books request failed' });
    }
}
