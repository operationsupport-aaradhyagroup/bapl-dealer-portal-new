import axios from 'axios';

const API = axios.create({
    // Vercel serverless functions hamesha /api route par chalti hain
    baseURL: '' 
});

export default API;