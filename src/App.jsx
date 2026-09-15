import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, Upload, Package, Search, Trash2, Plus, Minus, ClipboardCheck, CheckCircle2, XCircle, CalendarDays, ArrowLeft, Download } from 'lucide-react';
import API from './services/api';

const statusStyles = {
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Rejected: 'bg-red-50 text-red-700 border-red-200',
};

const formatPortalDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
};

function StatusBadge({ status = 'Pending' }) {
    return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[status] || statusStyles.Pending}`}>{status}</span>;
}

export default function App() {
    // --- URL AUTO-LOGIN LOGIC ---
    const queryParams = new URLSearchParams(window.location.search);
    const urlCustomerId = queryParams.get('customer_id');

    if (urlCustomerId) {
        localStorage.setItem('zoho_customer_id', urlCustomerId);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const initialId = urlCustomerId || localStorage.getItem('zoho_customer_id') || '';
    // ----------------------------

    const [customerId, setCustomerId] = useState(initialId);
    const [inputCustomerId, setInputCustomerId] = useState('');
    const [isIdentified, setIsIdentified] = useState(!!initialId);

    const [activeTab, setActiveTab] = useState('catalog');
    
    // Toast Notification State
    const [toast, setToast] = useState(null);
    const toastTimer = useRef(null);
    
    // API Optimization: Cache items to prevent reload delays
    const [items, setItems] = useState(() => {
        const cachedItems = localStorage.getItem('bhoodhan_catalog_items');
        return cachedItems ? JSON.parse(cachedItems) : [];
    });
    
    // Cart persistence
    const [cart, setCart] = useState(() => {
        const savedCart = localStorage.getItem('bhoodhan_dealer_cart');
        return savedCart ? JSON.parse(savedCart) : [];
    });

    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [confirmations, setConfirmations] = useState([]);
    const [confirmationsLoading, setConfirmationsLoading] = useState(false);
    const [confirmationsError, setConfirmationsError] = useState('');
    const [selectedConfirmation, setSelectedConfirmation] = useState(null);
    const [actionTarget, setActionTarget] = useState(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [confirmationUploadFile, setConfirmationUploadFile] = useState(null);
    const [isCreateConfirmationOpen, setIsCreateConfirmationOpen] = useState(false);
    const [newPeriodFrom, setNewPeriodFrom] = useState('');
    const [newPeriodTo, setNewPeriodTo] = useState('');
    const [newLedgerFile, setNewLedgerFile] = useState(null);

    async function fetchConfirmations() {
        setConfirmationsLoading(true);
        setConfirmationsError('');
        try {
            const response = await API.get('/api/balance-confirmations', {
                headers: { 'x-customer-id': customerId }
            });
            setConfirmations(response.data.records || []);
        } catch {
            setConfirmationsError('Balance Confirmations could not be loaded. Please try again later.');
        } finally {
            setConfirmationsLoading(false);
        }
    }

    useEffect(() => {
        localStorage.setItem('bhoodhan_dealer_cart', JSON.stringify(cart));
    }, [cart]);

    useEffect(() => {
        if (isIdentified) {
            fetchItems(); // Silently fetch to update prices in background
        }
    }, [isIdentified]);

    useEffect(() => {
        if (isIdentified && activeTab === 'confirmations') {
            fetchConfirmations();
        }
    }, [activeTab, isIdentified]);

    const fetchItems = async () => {
        try {
            const res = await API.get('/api/items');
            setItems(res.data.items || []);
            localStorage.setItem('bhoodhan_catalog_items', JSON.stringify(res.data.items || []));
        } catch (err) {
            console.error("Error fetching items:", err);
        }
    };

    const handleIdentify = (e) => {
        e.preventDefault();
        localStorage.setItem('zoho_customer_id', inputCustomerId);
        setCustomerId(inputCustomerId);
        setIsIdentified(true);
    };

    // Helper to show toast message
    const showToast = (message, type = 'info') => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type });
        toastTimer.current = setTimeout(() => {
            setToast(null);
        }, 3500);
    };

    const addToCart = (item) => {
        const existing = cart.find(c => c.item_id === item.item_id);
        if (existing) {
            setCart(cart.map(c => c.item_id === item.item_id ? { ...c, quantity: c.quantity + 1 } : c));
        } else {
            setCart([...cart, { ...item, quantity: 1 }]);
        }
        showToast(`${item.name} added to cart`, 'success');
    };

    const updateQuantity = (itemId, delta) => {
        const currentItem = cart.find(item => item.item_id === itemId);
        if (currentItem && delta < 0 && currentItem.quantity === 1) {
            removeFromCart(itemId);
            return;
        }
        setCart(cart.map(item => {
            if (item.item_id === itemId) {
                return { ...item, quantity: item.quantity + delta };
            }
            return item;
        }));
    };

    const removeFromCart = (itemId) => {
        const removedItem = cart.find(item => item.item_id === itemId);
        setCart(cart.filter(item => item.item_id !== itemId));
        if (removedItem) showToast(`${removedItem.name} removed from cart`, 'info');
    };

    const filteredItems = useMemo(() => {
        // Sirf valid rate wale items hi dikhayein (0 price wale hide)
        const availableItems = items.filter(item => item.rate && Number(item.rate) > 0);
        
        if (!searchQuery.trim()) return availableItems;
        
        const query = searchQuery.toLowerCase();
        return availableItems.filter(item => 
            item.name.toLowerCase().includes(query) || 
            (item.sku && item.sku.toLowerCase().includes(query))
        );
    }, [items, searchQuery]);

    const handlePlaceOrder = async () => {
        if (cart.length === 0) return;
        setLoading(true);
        try {
            const response = await API.post('/api/salesorders', { cartItems: cart }, {
                headers: { 'x-customer-id': customerId }
            });
            alert(`Order Placed Successfully! ID: ${response.data.salesorder?.salesorder_number || 'Confirmed'}`);
            setCart([]);
            localStorage.removeItem('bhoodhan_dealer_cart');
            setActiveTab('catalog');
        } catch (error) {
            const errMessage = error.response?.data?.error || 'Failed to place order. Make sure ledger is confirmed.';
            alert(typeof errMessage === 'object' ? JSON.stringify(errMessage) : errMessage);
            if (typeof errMessage === 'string' && (errMessage.toLowerCase().includes('ledger') || errMessage.toLowerCase().includes('document') || errMessage.toLowerCase().includes('blocked'))) {
                setActiveTab('confirmations');
            }
        }
        setLoading(false);
    };

    const submitConfirmationAction = async () => {
        if (!actionTarget) return;
        if (actionTarget.type === 'reject' && !rejectionReason.trim()) {
            showToast('Please enter a rejection reason.');
            return;
        }

        const { recordId, rowId, type } = actionTarget;
        setLoading(true);
        try {
            const response = await API.post(
                `/api/balance-confirmations/${recordId}/${type === 'approve' ? 'approve' : 'reject'}`,
                type === 'approve' ? { rowId } : { rowId, reason: rejectionReason.trim() },
                { headers: { 'x-customer-id': customerId } }
            );
            const updatedRecord = response.data.record;
            if (updatedRecord) {
                setSelectedConfirmation(updatedRecord);
                setConfirmations(current => current.map(record =>
                    (record.module_record_id || record.id) === recordId ? updatedRecord : record
                ));
            }
            showToast(type === 'approve' ? 'Balance Confirmation approved.' : 'Balance Confirmation rejected.');
            setActionTarget(null);
            setRejectionReason('');
        } catch (error) {
            showToast(error.response?.data?.error || 'This action could not be completed.');
        } finally {
            setLoading(false);
        }
    };

    const uploadLedgerForRow = async (recordId, rowId, file) => {
        if (!file) {
            showToast('Choose a PDF, JPG, JPEG, or PNG file first.');
            return null;
        }
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
            showToast('Use a PDF, JPG, JPEG, or PNG file up to 10 MB.');
            return null;
        }

        const formData = new FormData();
        formData.append('attachment', file);
        formData.append('rowId', rowId || '');
        const response = await API.post(`/api/balance-confirmations/${recordId}/attachments`, formData, {
            headers: { 'x-customer-id': customerId }
        });
        return response.data;
    };

    const uploadConfirmationAttachment = async (recordId, rowId) => {
        setLoading(true);
        try {
            const result = await uploadLedgerForRow(recordId, rowId, confirmationUploadFile);
            if (!result) return;
            if (result.record) setSelectedConfirmation(result.record);
            setConfirmationUploadFile(null);
            showToast(result.message || 'Ledger uploaded successfully.');
        } catch (error) {
            showToast(error.response?.data?.error || 'Attachment could not be uploaded.');
        } finally {
            setLoading(false);
        }
    };

    const viewLedgerAttachment = async (recordId, attachmentId, attachmentName) => {
        if (!attachmentId) {
            showToast('This ledger file is no longer available.', 'error');
            return;
        }
        setLoading(true);
        try {
            const response = await API.get(
                `/api/balance-confirmations/${recordId}/attachments/${attachmentId}`,
                {
                    headers: { 'x-customer-id': customerId },
                    responseType: 'blob',
                }
            );
            const url = URL.createObjectURL(response.data);
            const windowRef = window.open(url, '_blank', 'noopener,noreferrer');
            if (!windowRef) {
                const link = document.createElement('a');
                link.href = url;
                link.download = attachmentName || 'ledger-upload';
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (error) {
            showToast(error.response?.data?.error || 'The ledger attachment could not be opened.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const createBalanceConfirmation = async () => {
        if (!newPeriodFrom || !newPeriodTo) {
            showToast('Select the ledger period first.');
            return;
        }
        setLoading(true);
        try {
            const createResponse = await API.post('/api/balance-confirmations', {
                periodFrom: newPeriodFrom,
                periodTo: newPeriodTo,
            }, { headers: { 'x-customer-id': customerId } });
            let record = createResponse.data.record;
            let ledgerUploaded = false;
            const recordId = record?.module_record_id || record?.id;
            if (newLedgerFile && recordId) {
                const uploadResult = await uploadLedgerForRow(recordId, '0', newLedgerFile);
                if (uploadResult) {
                    record = uploadResult.record || record;
                    ledgerUploaded = true;
                }
            }
            if (record) {
                setConfirmations([record]);
                setSelectedConfirmation(null);
            }
            setIsCreateConfirmationOpen(false);
            setNewPeriodFrom('');
            setNewPeriodTo('');
            setNewLedgerFile(null);
            showToast(ledgerUploaded ? 'Ledger period added and ledger uploaded.' : 'Ledger period added. Upload the ledger from its detail page.');
        } catch (error) {
            showToast(error.response?.data?.error || 'Balance Confirmation could not be created.');
        } finally {
            setLoading(false);
        }
    };

    // --- IDENTIFICATION SCREEN ---
    if (!isIdentified) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-gray-100">
                    <div className="flex justify-center mb-6">
                        <img 
                            src="/assets/images/bhoodhan_logo-removebg-preview.png" 
                            alt="Bhoodhan Agriventures" 
                            className="h-16 w-auto object-contain"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                    </div>
                    <h2 className="text-2xl font-bold text-center text-gray-900 mb-1">Dealer Order Portal</h2>
                    <p className="text-center text-orange-600 text-sm font-semibold mb-6">Bhoodhan Agriventures Pvt. Ltd.</p>
                    <p className="text-center text-gray-500 text-sm mb-6">Please enter your Zoho Customer ID to continue.</p>
                    <form onSubmit={handleIdentify} className="space-y-4">
                        <input 
                            type="text" 
                            required 
                            placeholder="Enter Customer ID" 
                            className="w-full p-3 bg-gray-50 border border-gray-200 text-gray-900 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none placeholder-gray-400"
                            value={inputCustomerId}
                            onChange={(e) => setInputCustomerId(e.target.value)}
                        />
                        <button type="submit" className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition shadow-lg shadow-orange-500/30">
                            Continue to Portal
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // --- MAIN LAYOUT WITH PREMIUM LIGHT THEME ---
    return (
        <div className="portal-shell h-screen w-full bg-gray-50 text-gray-800 flex font-sans overflow-hidden">
            {/* Left Sidebar */}
            <aside className="w-64 bg-white flex flex-col hidden md:flex border-r border-gray-200 shadow-sm z-10">
                <div className="p-6 flex items-center gap-3 border-b border-gray-100">
                    <img 
                        src="/assets/images/bhoodhan_logo-removebg-preview.png" 
                        alt="Bhoodhan Logo" 
                        className="h-10 w-10 object-contain p-0.5"
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div className="overflow-hidden">
                        <h1 className="font-bold text-gray-900 text-sm truncate">Bhoodhan Agriventures</h1>
                        <p className="text-xs text-green-700 font-semibold truncate">Dealer Portal</p>
                    </div>
                </div>

                <nav className="p-4 space-y-2 mt-2 flex-1">
                    <button 
                        onClick={() => setActiveTab('catalog')} 
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${activeTab === 'catalog' ? 'bg-orange-50 text-orange-700 border-l-4 border-orange-500' : 'hover:bg-gray-50 text-gray-600 hover:text-gray-900'}`}
                    >
                        <Package className="w-5 h-5" /> Products Catalog
                    </button>
                    
                    <button 
                        onClick={() => setActiveTab('cart')} 
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-semibold text-sm transition-all ${activeTab === 'cart' ? 'bg-orange-50 text-orange-700 border-l-4 border-orange-500' : 'hover:bg-gray-50 text-gray-600 hover:text-gray-900'}`}
                    >
                        <div className="flex items-center gap-3">
                            <ShoppingCart className="w-5 h-5" /> Cart
                        </div>
                        {cart.length > 0 && (
                            <span className="bg-orange-500 text-white font-bold px-2.5 py-0.5 rounded-full text-xs shadow-sm">
                                {cart.reduce((a,c) => a + c.quantity, 0)}
                            </span>
                        )}
                    </button>

                    <button 
                        onClick={() => setActiveTab('confirmations')} 
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${activeTab === 'confirmations' ? 'bg-orange-50 text-orange-700 border-l-4 border-orange-500' : 'hover:bg-gray-50 text-gray-600 hover:text-gray-900'}`}
                    >
                        <ClipboardCheck className="w-5 h-5" /> Balance Confirmations
                    </button>
                </nav>
            </aside>

            {/* Mobile Top Header */}
            <div className="md:hidden w-full bg-white text-gray-900 fixed top-0 z-20 border-b border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 px-4 pt-3">
                    <img 
                        src="/assets/images/bhoodhan_logo-removebg-preview.png" 
                        alt="Logo" 
                        className="h-8 w-8 object-contain"
                    />
                    <span className="font-bold text-sm">Bhoodhan Dealer Portal</span>
                </div>
                <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-2">
                    <button onClick={() => setActiveTab('catalog')} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${activeTab === 'catalog' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}><Package className="h-4 w-4" />Products</button>
                    <button onClick={() => setActiveTab('cart')} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${activeTab === 'cart' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}><ShoppingCart className="h-4 w-4" />Cart {cart.length > 0 && `(${cart.reduce((a,c) => a + c.quantity, 0)})`}</button>
                    <button onClick={() => setActiveTab('confirmations')} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${activeTab === 'confirmations' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}><ClipboardCheck className="h-4 w-4" /><span className="hidden min-[390px]:inline">Confirmations</span><span className="min-[390px]:hidden">Balances</span></button>
                </div>
            </div>

            {/* Main Content Area */}
            <main className="portal-content flex-1 p-4 pt-28 sm:p-6 sm:pt-28 md:p-10 md:pt-10 md:ml-0 md:mt-0 overflow-y-auto bg-gray-50 relative">
                
                {/* --- TOAST NOTIFICATION UI --- */}
{toast && (
    <div role="status" className={`fixed top-20 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-xl md:top-8 md:right-8 ${toast.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-white text-slate-700'}`}>
        {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : toast.type === 'error' ? <XCircle className="h-5 w-5 shrink-0 text-red-600" /> : <ShoppingCart className="h-5 w-5 shrink-0 text-blue-600" />}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={() => setToast(null)} className="ml-2 text-lg leading-none opacity-50 hover:opacity-100" aria-label="Dismiss notification">×</button>
    </div>
)}

                <div className="max-w-5xl mx-auto">
                    
                    {/* 1. PRODUCT CATALOG */}
                    {activeTab === 'catalog' && (
                        <div>
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                                <div>
                                    <h2 className="text-2xl font-black text-gray-900 tracking-tight sm:text-3xl">Product Catalog</h2>
                                    <p className="text-sm text-gray-500 mt-1 font-medium">Browse and select items for your order.</p>
                                </div>
                                <div className="relative w-full md:w-80 shadow-sm rounded-xl">
                                    <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" />
                                    <input 
                                        type="text"
                                        placeholder="Search by Name or SKU..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 text-gray-900 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm placeholder-gray-400 transition-all"
                                    />
                                </div>
                            </div>

                            {filteredItems.length === 0 ? (
                                <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-sm">
                                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500 font-semibold">No products found matching your search.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {filteredItems.map(item => {
                                        // Check karein ki ye item cart mein pehle se hai ya nahi
                                        const cartItem = cart.find(c => c.item_id === item.item_id);
                                        
                                        return (
                                            <div key={item.item_id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all flex flex-col justify-between group">
                                                <div>
                                                    <h3 className="font-bold text-gray-900 text-base mb-1 group-hover:text-orange-600 transition-colors">{item.name}</h3>
                                                    <p className="text-xs text-gray-400 mb-5 font-mono bg-gray-50 inline-block px-2 py-1 rounded">SKU: {item.sku || 'N/A'}</p>
                                                </div>
                                                <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                                                    <span className="font-black text-xl text-green-700">₹{item.rate}</span>
                                                    
                                                    {/* DYNAMIC CART CONTROLS */}
                                                    {cartItem ? (
                                                        <div className="flex items-center gap-2 bg-gray-50 px-2.5 py-1.5 rounded-xl border border-gray-200">
                                                            <button 
                                                                onClick={() => updateQuantity(item.item_id, -1)}
                                                                className="text-gray-500 hover:text-orange-600 transition p-1"
                                                            >
                                                                <Minus className="w-4 h-4" />
                                                            </button>
                                                            <span className="font-bold text-sm text-gray-900 w-5 text-center">{cartItem.quantity}</span>
                                                            <button 
                                                                onClick={() => updateQuantity(item.item_id, 1)}
                                                                className="text-gray-500 hover:text-orange-600 transition p-1"
                                                            >
                                                                <Plus className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => addToCart(item)}
                                                            className="bg-orange-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-600 transition-colors flex items-center gap-1.5 shadow-sm shadow-orange-500/20"
                                                        >
                                                            Add <ShoppingCart className="w-3.5 h-3.5"/>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 2. SHOPPING CART */}
                    {activeTab === 'cart' && (
                        <div className="bg-white p-4 sm:p-8 rounded-2xl shadow-sm border border-gray-200 max-w-2xl mx-auto">
                            <h2 className="text-2xl font-black text-gray-900 mb-6">Review Cart</h2>
                            {cart.length === 0 ? (
                                <div className="text-center py-12">
                                    <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500 text-sm font-medium">Your cart is empty.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {cart.map(item => (
                                        <div key={item.item_id} className="flex flex-wrap justify-between items-center py-4 border-b border-gray-100 gap-3 sm:flex-nowrap sm:gap-4">
                                            <div className="flex-1">
                                                <h4 className="font-bold text-gray-900 text-sm">{item.name}</h4>
                                                <p className="text-xs text-green-700 mt-0.5 font-semibold">₹{item.rate} per unit</p>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 bg-gray-50 px-2.5 py-1.5 rounded-xl border border-gray-200">
                                                <button 
                                                    onClick={() => updateQuantity(item.item_id, -1)}
                                                    className="text-gray-500 hover:text-orange-600 transition p-1"
                                                >
                                                    <Minus className="w-3.5 h-3.5" />
                                                </button>
                                                <span className="font-bold text-sm text-gray-900 w-6 text-center">{item.quantity}</span>
                                                <button 
                                                    onClick={() => updateQuantity(item.item_id, 1)}
                                                    className="text-gray-500 hover:text-orange-600 transition p-1"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            </div>

                                            <span className="font-black text-base text-gray-900 text-right sm:w-24">₹{(item.rate * item.quantity).toFixed(2)}</span>

                                            <button 
                                                onClick={() => removeFromCart(item.item_id)}
                                                className="text-red-400 hover:text-red-600 p-2 transition bg-red-50 hover:bg-red-100 rounded-lg"
                                                title="Remove item"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}

                                    <div className="pt-6 flex flex-col gap-2 border-t border-gray-200 mt-4 sm:flex-row sm:justify-between sm:items-end">
                                        <span className="text-gray-500 font-bold uppercase text-xs tracking-wider">Total Amount</span>
                                        <span className="text-3xl font-black text-green-700">₹{cart.reduce((a,c) => a + (c.rate * c.quantity), 0).toFixed(2)}</span>
                                    </div>

                                    <button 
                                        onClick={handlePlaceOrder} 
                                        disabled={loading}
                                        className="w-full mt-6 bg-green-700 text-white font-bold py-4 rounded-xl hover:bg-green-800 transition shadow-lg shadow-green-700/30"
                                    >
                                        {loading ? 'Processing Order...' : 'Confirm & Place Order'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'confirmations' && (
                        <div>
                            {selectedConfirmation ? (() => {
                                const recordId = selectedConfirmation.module_record_id || selectedConfirmation.id;
                                const ledgerRows = selectedConfirmation.cf_cm_all_ledgers_details || selectedConfirmation.ledgerDetails || selectedConfirmation.periods || [];
                                return (
                                    <div className="space-y-6">
                                        <button onClick={() => setSelectedConfirmation(null)} className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-orange-600">
                                            <ArrowLeft className="w-4 h-4" /> Back to Balance Confirmations
                                        </button>
                                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8">
                                            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                                <div>
                                                    <p className="text-xs font-bold uppercase tracking-wider text-orange-600">Balance Confirmation</p>
                                                    <h2 className="mt-1 text-2xl font-black text-gray-900">{selectedConfirmation.record_name || selectedConfirmation.reference || 'Confirmation details'}</h2>
                                                    <p className="mt-2 text-sm text-gray-500">Customer number: {selectedConfirmation.cf_custom_number || selectedConfirmation.customerNumber || '—'}</p>
                                                </div>
                                                <StatusBadge status={selectedConfirmation.status || ledgerRows[0]?.cf_status || 'Pending'} />
                                            </div>
                                            <div className="mt-6 grid grid-cols-1 gap-4 border-t border-gray-100 pt-6 sm:grid-cols-2 lg:grid-cols-3">
                                                <div><p className="text-xs font-semibold text-gray-400">Created</p><p className="mt-1 font-bold text-gray-700">{formatPortalDate(selectedConfirmation.created_time || selectedConfirmation.createdAt)}</p></div>
                                                <div><p className="text-xs font-semibold text-gray-400">Last updated</p><p className="mt-1 font-bold text-gray-700">{formatPortalDate(selectedConfirmation.last_modified_time || selectedConfirmation.updatedAt)}</p></div>
                                                <div><p className="text-xs font-semibold text-gray-400">Reference</p><p className="mt-1 font-bold text-gray-700">{recordId || '—'}</p></div>
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                                            <div className="border-b border-gray-100 p-6"><h3 className="text-lg font-black text-gray-900">Ledger periods</h3><p className="mt-1 text-sm text-gray-500">Review each period and confirm the balance.</p></div>
                                            {ledgerRows.length === 0 ? <div className="p-10 text-center text-sm font-medium text-gray-500">No ledger periods are available on this confirmation.</div> : (
                                                <div className="divide-y divide-gray-100">
                                                    {ledgerRows.map((row, index) => {
                                                        const status = row.cf_status || row.status || 'Pending';
                                                        const rowId = row.row_id || row.id || String(index);
                                                        const attachmentName = row.cf_ledger_upload_formatted || row.attachmentName;
                                                        return <div key={rowId} className="p-6">
                                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                                                <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-5 w-5 text-orange-500" /><div><p className="font-bold text-gray-900">{formatPortalDate(row.cf_period_from || row.periodFrom)} — {formatPortalDate(row.cf_period_to || row.periodTo)}</p><div className="mt-2"><StatusBadge status={status} /></div></div></div>
                                                                {status === 'Pending' && <div className="flex flex-wrap gap-2"><button disabled={loading} onClick={() => setActionTarget({ type: 'approve', recordId, rowId })} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><CheckCircle2 className="h-4 w-4" /> Approve</button><button disabled={loading} onClick={() => setActionTarget({ type: 'reject', recordId, rowId })} className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"><XCircle className="h-4 w-4" /> Reject</button></div>}
                                                            </div>
                                                            {row.cf_rejection_reason && <p className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700"><span className="font-bold">Rejection reason:</span> {row.cf_rejection_reason}</p>}
                                                            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-bold text-gray-700">Ledger Upload</p><p className="mt-1 text-xs text-gray-500">{attachmentName || 'Upload the ledger for this period (PDF, JPG, or PNG; max 10 MB).'}</p></div>{attachmentName ? <button className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-700"><Download className="h-4 w-4" /> View attachment</button> : <div className="flex flex-wrap items-center gap-2"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setConfirmationUploadFile(event.target.files?.[0] || null)} className="max-w-52 text-xs" /><button disabled={loading} onClick={() => uploadConfirmationAttachment(recordId, rowId)} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60"><Upload className="h-4 w-4" /> Upload ledger</button></div>}</div>
                                                        </div>;
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div>
                                    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between"><div><h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">Balance Confirmations</h2><p className="mt-1 text-sm font-medium text-gray-500">Add ledger periods and uploads under the same customer confirmation.</p></div><div className="grid grid-cols-[1fr_auto] gap-3"><button onClick={() => setIsCreateConfirmationOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"><Plus className="h-4 w-4" /> Add Ledger Period</button><button onClick={fetchConfirmations} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Refresh</button></div></div>
                                    {confirmationsLoading ? <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm font-semibold text-gray-500">Loading Balance Confirmations…</div> : confirmationsError ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">{confirmationsError}</div> : confirmations.length === 0 ? <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center"><ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-gray-300" /><p className="font-bold text-gray-600">No Balance Confirmations are available.</p><p className="mt-1 text-sm text-gray-500">Add a ledger period to create the first confirmation.</p></div> : (() => { const record = confirmations[0]; const recordId = record.module_record_id || record.id; const rows = record.cf_cm_all_ledgers_details || record.ledgerDetails || record.periods || []; return <div className="space-y-6"><div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-orange-600">Current Balance Confirmation</p><div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h3 className="text-2xl font-black text-gray-900">{record.record_name || 'Balance Confirmation'}</h3><p className="mt-1 text-sm text-gray-500">Customer number: {record.cf_custom_number || record.customerNumber || '—'}</p></div><p className="text-sm font-semibold text-gray-500">Updated {formatPortalDate(record.last_modified_time || record.updatedAt)}</p></div></div><div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-100 p-6"><h3 className="text-lg font-black text-gray-900">Ledger periods</h3><p className="mt-1 text-sm text-gray-500">Upload, approve, or reject each period directly from this page.</p></div>{rows.length === 0 ? <div className="p-10 text-center text-sm font-medium text-gray-500">No ledger periods are available.</div> : <div className="divide-y divide-gray-100">{rows.map((row, index) => { const status = row.cf_status || row.status || 'Pending'; const rowId = row.row_id || row.id || String(index); const attachmentName = row.cf_ledger_upload_formatted || row.attachmentName; const attachmentId = row.cf_ledger_upload || row.attachmentId; return <div key={rowId} className="p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-5 w-5 text-orange-500" /><div><p className="font-bold text-gray-900">{formatPortalDate(row.cf_period_from || row.periodFrom)} — {formatPortalDate(row.cf_period_to || row.periodTo)}</p><div className="mt-2"><StatusBadge status={status} /></div></div></div>{status === 'Pending' && <div className="flex flex-wrap gap-2"><button disabled={loading} onClick={() => setActionTarget({ type: 'approve', recordId, rowId })} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><CheckCircle2 className="h-4 w-4" /> Approve</button><button disabled={loading} onClick={() => setActionTarget({ type: 'reject', recordId, rowId })} className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"><XCircle className="h-4 w-4" /> Reject</button></div>}</div>{row.cf_rejection_reason && <p className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700"><span className="font-bold">Rejection reason:</span> {row.cf_rejection_reason}</p>}<div className="mt-5 flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-bold text-gray-700">Ledger Upload</p><p className="mt-1 text-xs text-gray-500">{attachmentName || 'Upload the ledger for this period (PDF, JPG, or PNG; max 10 MB).'}</p></div>{attachmentName ? <button type="button" disabled={loading} onClick={() => viewLedgerAttachment(recordId, attachmentId, attachmentName)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-60"><Download className="h-4 w-4" /> View attachment</button> : <div className="flex flex-wrap items-center gap-2"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setConfirmationUploadFile(event.target.files?.[0] || null)} className="max-w-52 text-xs" /><button disabled={loading} onClick={() => uploadConfirmationAttachment(recordId, rowId)} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-60"><Upload className="h-4 w-4" /> Upload ledger</button></div>}</div></div>; })}</div>}</div></div>; })()}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </main>

            {actionTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-black text-gray-900">{actionTarget.type === 'approve' ? 'Approve Balance Confirmation?' : 'Reject Balance Confirmation?'}</h3><p className="mt-2 text-sm text-gray-500">{actionTarget.type === 'approve' ? 'Are you sure you want to approve this Balance Confirmation?' : 'Tell us why this balance does not match your records.'}</p>{actionTarget.type === 'reject' && <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Enter rejection reason" className="mt-4 min-h-28 w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />}<div className="mt-6 flex justify-end gap-3"><button disabled={loading} onClick={() => { setActionTarget(null); setRejectionReason(''); }} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button><button disabled={loading} onClick={submitConfirmationAction} className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${actionTarget.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>{loading ? 'Saving…' : actionTarget.type === 'approve' ? 'Approve' : 'Reject'}</button></div></div></div>}
            {isCreateConfirmationOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-black text-gray-900">Add Ledger Period</h3><p className="mt-2 text-sm text-gray-500">This adds another line to the customer’s latest Balance Confirmation. A new record is created only when the customer has no confirmation yet.</p><div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-gray-700">Period from<input type="date" value={newPeriodFrom} onChange={(event) => setNewPeriodFrom(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 p-3 font-normal outline-none focus:border-orange-500" /></label><label className="text-sm font-bold text-gray-700">Period to<input type="date" value={newPeriodTo} onChange={(event) => setNewPeriodTo(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 p-3 font-normal outline-none focus:border-orange-500" /></label></div><label className="mt-4 block text-sm font-bold text-gray-700">Ledger upload <span className="font-normal text-gray-400">(optional, PDF/JPG/PNG, max 10 MB)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setNewLedgerFile(event.target.files?.[0] || null)} className="mt-2 block w-full rounded-xl border border-gray-200 p-2 text-xs font-normal" /></label><div className="mt-6 flex justify-end gap-3"><button disabled={loading} onClick={() => { setIsCreateConfirmationOpen(false); setNewLedgerFile(null); }} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button><button disabled={loading} onClick={createBalanceConfirmation} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"><Plus className="h-4 w-4" /> {loading ? 'Adding…' : 'Add ledger period'}</button></div></div></div>}
        </div>
    );
}
