import axios from 'axios';

let cachedAccessToken = null;
let accessTokenExpiresAt = 0;
let refreshInFlight = null;

const REFRESH_BUFFER_MS = 60_000;

function getAccountsTokenUrl() {
    const configuredUrl = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
    return configuredUrl.endsWith('/token')
        ? configuredUrl
        : `${configuredUrl.replace(/\/$/, '')}/oauth/v2/token`;
}

function getBooksApiUrl() {
    return process.env.ZOHO_BOOKS_API_URL || 'https://www.zohoapis.in/books/v3';
}

async function refreshAccessToken() {
    const response = await axios.post(getAccountsTokenUrl(), null, {
        timeout: 10_000,
        params: {
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            grant_type: 'refresh_token'
        }
    });

    const expiresInSeconds = Number(response.data.expires_in_sec || response.data.expires_in || 3600);
    cachedAccessToken = response.data.access_token;
    accessTokenExpiresAt = Date.now() + (expiresInSeconds * 1000) - REFRESH_BUFFER_MS;
    return cachedAccessToken;
}

export async function getAccessToken() {
    if (cachedAccessToken && Date.now() < accessTokenExpiresAt) {
        return cachedAccessToken;
    }

    if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken()
            .catch((error) => {
                const message = error.response?.data?.message || error.response?.data?.error || error.message;
                console.error('Zoho access-token refresh failed:', message);
                throw new Error('Could not authenticate with Zoho');
            })
            .finally(() => {
                refreshInFlight = null;
            });
    }

    return refreshInFlight;
}

export const zohoApi = async (token) => {
    const orgId = process.env.ZOHO_ORG_ID;
    return axios.create({
        baseURL: getBooksApiUrl(),
        timeout: 15_000,
        params: {
            organization_id: orgId
        },
        headers: {
            'Authorization': `Zoho-oauthtoken ${token}`,
            'X-com-zoho-books-organizationid': orgId,
            'Content-Type': 'application/json'
        }
    });
};
