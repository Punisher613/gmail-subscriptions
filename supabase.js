// ── Supabase Data Layer ──
// Replaces localStorage with Supabase for multi-user sync

const SUPABASE_URL = 'https://ycwquunujxvykrlutvfq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JGTtgary0oUjl1mXZBsfhw_fbnUZvwM';
const OWNER_EMAIL  = 'saul@gothaminjury.com';
const FREE_ITEM_LIMIT = 10;

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let _currentUser = null;
let _userPlan = 'free'; // 'free' or 'pro'

// ── Auth ──
async function initAuth() {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  _currentUser = session.user;

  // Owner always gets pro
  if (_currentUser.email === OWNER_EMAIL) {
    _userPlan = 'pro';
  } else {
    // Check user plan from database
    const { data } = await _sb.from('user_plans')
      .select('plan')
      .eq('user_id', _currentUser.id)
      .single();
    _userPlan = data?.plan || 'free';
  }

  return _currentUser;
}

function getCurrentUser() { return _currentUser; }
function getUserPlan() { return _userPlan; }
function isOwner() { return _currentUser?.email === OWNER_EMAIL; }
function isPro() { return _userPlan === 'pro'; }
function canAddMore(currentCount) { return isPro() || currentCount < FREE_ITEM_LIMIT; }

async function logout() {
  await _sb.auth.signOut();
  window.location.href = 'login.html';
}

// ── Items (replaces custom-items in localStorage) ──
async function getItems() {
  const { data, error } = await _sb.from('items')
    .select('*')
    .eq('user_id', _currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('getItems:', error); return []; }
  return data.map(row => ({
    id: row.id,
    name: row.name,
    note: row.note || '',
    section: row.section,
    date: row.item_date || '',
    amount: row.amount || 0
  }));
}

async function addItem(item) {
  const { data, error } = await _sb.from('items').insert({
    user_id: _currentUser.id,
    name: item.name,
    note: item.note,
    section: item.section,
    item_date: item.date || null,
    amount: item.amount || 0
  }).select().single();
  if (error) { console.error('addItem:', error); return null; }
  return { ...item, id: data.id };
}

async function updateItem(id, updates) {
  const dbUpdates = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.note !== undefined) dbUpdates.note = updates.note;
  if (updates.date !== undefined) dbUpdates.item_date = updates.date;
  if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
  if (updates.section !== undefined) dbUpdates.section = updates.section;

  const { error } = await _sb.from('items')
    .update(dbUpdates)
    .eq('id', id)
    .eq('user_id', _currentUser.id);
  if (error) console.error('updateItem:', error);
}

async function deleteItem(id) {
  // Delete item and its settings
  await _sb.from('item_settings').delete().eq('item_id', id).eq('user_id', _currentUser.id);
  await _sb.from('items').delete().eq('id', id).eq('user_id', _currentUser.id);
}

// ── Item Settings (replaces status:{id}, nextbill:{id}, monthlyprice:{id}) ──
async function getItemSettings(itemId) {
  const { data } = await _sb.from('item_settings')
    .select('*')
    .eq('item_id', itemId)
    .eq('user_id', _currentUser.id)
    .single();
  return data || {};
}

async function getAllItemSettings() {
  const { data, error } = await _sb.from('item_settings')
    .select('*')
    .eq('user_id', _currentUser.id);
  if (error) { console.error('getAllSettings:', error); return {}; }
  const map = {};
  (data || []).forEach(row => {
    map[row.item_id] = {
      status: row.status || 'active',
      nextbill: row.nextbill || null,
      monthlyprice: row.monthly_price || null
    };
  });
  return map;
}

async function saveSetting(itemId, key, value) {
  // Upsert into item_settings
  const column = key === 'monthlyprice' ? 'monthly_price' : key;
  const { data: existing } = await _sb.from('item_settings')
    .select('id')
    .eq('item_id', itemId)
    .eq('user_id', _currentUser.id)
    .single();

  if (existing) {
    await _sb.from('item_settings')
      .update({ [column]: value })
      .eq('id', existing.id);
  } else {
    await _sb.from('item_settings')
      .insert({
        user_id: _currentUser.id,
        item_id: itemId,
        [column]: value
      });
  }
}

// Convenience wrappers matching old localStorage API
async function getStatus(id) {
  const s = await getItemSettings(id);
  return s.status || 'active';
}
async function getNextBill(id) {
  const s = await getItemSettings(id);
  return s.nextbill || null;
}
async function getMonthlyPrice(id) {
  const s = await getItemSettings(id);
  return s.monthly_price ? parseFloat(s.monthly_price) : null;
}

// ── Files/attachments ──
async function getFiles(id) {
  const s = await getItemSettings(id);
  try { return JSON.parse(s.files_json || '[]'); }
  catch { return []; }
}
async function saveFiles(id, files) {
  await saveSetting(id, 'files_json', JSON.stringify(files));
}
