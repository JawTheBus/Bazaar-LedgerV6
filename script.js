/* ---------------- Stockage : base de données Supabase ---------------- */

let store = { currentProfile: null, profiles: [], data: {} };
let currentProfile = null; // miroir pratique de store.currentProfile
let editingRowOpen = false; // évite qu'une actualisation auto n'écrase une saisie en cours

let trades = [];
let history = [];
let favorites = [];
let buyOrders = [];
let bazaarMap = {}; // displayName(lowercase) -> {id, buy, sell}

const dataKey = name => name.toLowerCase();
const fmtNum = n => Number(n).toLocaleString('fr-FR', {maximumFractionDigits: 1});
const fmtCoins = n => (n >= 0 ? '+' : '') + fmtNum(n);
const humanize = id => id.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
const nowLabel = () => new Date().toLocaleString('fr-FR');
const avatarUrl = name => `https://minotar.net/helm/${encodeURIComponent(name)}/72.png`;

const SB_TABLE_URL = `${SUPABASE_CONFIG.url}/rest/v1/ledger_store`;

function sbHeaders(extra = {}){
  return {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function updateFileStatus(ok){
  const el = document.getElementById('fileStatus');
  el.textContent = ok
    ? 'Connecté à Supabase — sauvegarde automatique à chaque modification.'
    : "Impossible de joindre Supabase. Vérifie l'URL/clé dans supabase-config.js et que la table ledger_store existe.";
}

async function fetchStore(){
  try{
    const res = await fetch(`${SB_TABLE_URL}?id=eq.1&select=data`, {headers: sbHeaders()});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    updateFileStatus(true);
    if(rows.length && rows[0].data){
      return rows[0].data;
    }
    return { currentProfile: null, profiles: [], data: {} };
  }catch(e){
    updateFileStatus(false);
    return null;
  }
}

async function persist(){
  store.currentProfile = currentProfile;
  try{
    const res = await fetch(`${SB_TABLE_URL}?id=eq.1`, {
      method: 'PATCH',
      headers: sbHeaders({'Prefer': 'return=minimal'}),
      body: JSON.stringify({ data: store })
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    updateFileStatus(true);
  }catch(e){
    updateFileStatus(false);
  }
}

function exportData(){
  store.currentProfile = currentProfile;
  const blob = new Blob([JSON.stringify(store, null, 2)], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bazaar-ledger-data.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importData(file){
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!parsed || typeof parsed !== 'object') throw new Error('format invalide');
    if(!confirm("Remplacer toutes les données actuelles (sur Supabase) par le contenu de ce fichier ?")) return;

    store = Object.assign({currentProfile: null, profiles: [], data: {}}, parsed);
    currentProfile = store.currentProfile || null;
    if(currentProfile && !store.profiles.find(p => p.name.toLowerCase() === currentProfile.toLowerCase())){
      currentProfile = null;
    }
    renderProfileChip();
    loadProfileData();
    render();
    renderFavorites();
    await persist();
    if(!currentProfile) openModal(false);
  }catch(err){
    alert("Impossible de lire ce fichier (format invalide).");
  }
}

async function pollStore(){
  if(editingRowOpen) return; // ne pas écraser une saisie en cours (formulaire de clôture ouvert)
  const fresh = await fetchStore();
  if(!fresh) return;
  store = fresh;
  if(currentProfile && !store.profiles.find(p => p.name.toLowerCase() === currentProfile.toLowerCase())){
    currentProfile = null;
    openModal(false);
  }
  loadProfileData();
  render();
  renderFavorites();
}

/* ---------------- Profil courant ---------------- */

function loadProfileData(){
  if(!currentProfile){ trades = []; history = []; favorites = []; buyOrders = []; return; }
  const raw = store.data[dataKey(currentProfile)] || {trades: [], history: [], favorites: [], buyOrders: []};
  trades = raw.trades || [];
  history = raw.history || [];
  favorites = raw.favorites || [];
  buyOrders = raw.buyOrders || [];
}

async function saveProfileData(){
  if(!currentProfile) return;
  store.data[dataKey(currentProfile)] = {trades, history, favorites, buyOrders};
  await persist();
}

async function setCurrentProfile(name){
  currentProfile = name;
  loadProfileData();
  renderProfileChip();
  render();
  renderFavorites();
  closeModal();
  await persist();
}

async function createProfile(name){
  name = name.trim();
  if(!name) return;
  if(!store.profiles.find(p => p.name.toLowerCase() === name.toLowerCase())){
    store.profiles.push({name});
  }
  await setCurrentProfile(name);
}

async function deleteProfile(name){
  if(!confirm(`Supprimer le profil "${name}" et toutes ses données ?`)) return;
  store.profiles = store.profiles.filter(p => p.name.toLowerCase() !== name.toLowerCase());
  delete store.data[dataKey(name)];
  if(currentProfile && currentProfile.toLowerCase() === name.toLowerCase()){
    currentProfile = null;
  }
  await persist();
  renderModalList();
  if(!currentProfile){
    if(store.profiles.length){ await setCurrentProfile(store.profiles[0].name); }
    else { openModal(false); renderProfileChip(); render(); renderFavorites(); }
  }
}

/* ---------------- Modal ---------------- */

function openModal(closable){
  document.getElementById('closeModalBtn').style.display = closable ? 'block' : 'none';
  renderModalList();
  document.getElementById('profileModal').classList.add('open');
  document.getElementById('newProfileInput').focus();
}
function closeModal(){
  document.getElementById('profileModal').classList.remove('open');
  document.getElementById('newProfileInput').value = '';
}
function renderModalList(){
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  if(!store.profiles.length){
    list.innerHTML = '<div class="fav-empty">Aucun profil enregistré pour le moment.</div>';
    return;
  }
  store.profiles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'profile-row';
    row.innerHTML = `
      <img src="${avatarUrl(p.name)}" alt="">
      <span>${p.name}</span>
      <button class="del" data-del="${p.name}" title="Supprimer">×</button>
    `;
    row.addEventListener('click', e => {
      if(e.target.closest('button')) return;
      setCurrentProfile(p.name);
    });
    row.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      deleteProfile(p.name);
    });
    list.appendChild(row);
  });
}

document.getElementById('profileChip').addEventListener('click', () => openModal(!!currentProfile));
document.getElementById('closeModalBtn').addEventListener('click', closeModal);
document.getElementById('createProfileBtn').addEventListener('click', () => {
  createProfile(document.getElementById('newProfileInput').value);
});
document.getElementById('newProfileInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') createProfile(e.target.value);
});

function renderProfileChip(){
  const nameEl = document.getElementById('profileName');
  const avatarEl = document.getElementById('profileAvatar');
  if(currentProfile){
    nameEl.textContent = currentProfile;
    avatarEl.src = avatarUrl(currentProfile);
  } else {
    nameEl.textContent = 'Aucun profil';
    avatarEl.src = '';
  }
}

/* ---------------- Trades / totaux ---------------- */

function computeTotals(){
  let net = 0, gains = 0, losses = 0, closedCount = 0;
  for(const h of history){
    net += h.result;
    if(h.result >= 0) gains += h.result; else losses += Math.abs(h.result);
    closedCount++;
  }
  return {net, gains, losses, closedCount};
}

function computeGlobalNet(){
  let net = 0;
  Object.values(store.data).forEach(profileData => {
    (profileData.history || []).forEach(h => { net += h.result; });
  });
  return net;
}

function flashPurse(isGain){
  const box = document.getElementById('statusBox');
  box.classList.remove('flash-gain','flash-loss');
  void box.offsetWidth;
  box.classList.add(isGain ? 'flash-gain' : 'flash-loss');
  setTimeout(() => box.classList.remove('flash-gain','flash-loss'), 900);
}

function render(){
  renderBuyOrders();
  const {net, gains, losses, closedCount} = computeTotals();
  const globalNet = computeGlobalNet();

  const purseAmount = document.getElementById('purseAmount');
  purseAmount.textContent = fmtCoins(net);
  purseAmount.className = 'purse-amount ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero');

  const totalAmount = document.getElementById('totalPurseAmount');
  totalAmount.textContent = fmtCoins(globalNet);
  totalAmount.className = 'purse-amount small ' + (globalNet > 0 ? 'pos' : globalNet < 0 ? 'neg' : 'zero');

  document.getElementById('statOpen').textContent = trades.length;
  document.getElementById('statGains').textContent = '+' + fmtNum(gains);
  document.getElementById('statLosses').textContent = '-' + fmtNum(losses);
  document.getElementById('statClosed').textContent = closedCount;

  const body = document.getElementById('tradesBody');
  body.innerHTML = '';
  document.getElementById('tradesEmpty').style.display = trades.length ? 'none' : 'block';

  trades.forEach(t => {
    const tr = document.createElement('tr');
    tr.dataset.id = t.id;
    const match = bazaarMap[t.item.toLowerCase()];
    const currentPrice = match ? match.buy : null;
    const latent = currentPrice !== null ? (currentPrice - t.buyPrice) * t.qty : null;
    const latentClass = latent === null ? 'muted' : (latent >= 0 ? 'latent-pos' : 'latent-neg');
    const latentLabel = latent === null ? '—' : fmtCoins(latent);
    tr.innerHTML = `
      <td class="item-name">${t.item}</td>
      <td>${fmtNum(t.buyPrice)}</td>
      <td>${fmtNum(t.qty)}</td>
      <td>${fmtNum(t.buyPrice * t.qty)}</td>
      <td class="${latentClass}">${latentLabel}</td>
      <td class="muted">${t.openedAt}</td>
      <td>
        <div class="row-actions" id="actions-${t.id}">
          <button class="ok" data-action="close" data-id="${t.id}">Clôturer</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  const hBody = document.getElementById('historyBody');
  hBody.innerHTML = '';
  document.getElementById('historyEmpty').style.display = history.length ? 'none' : 'block';

  [...history].reverse().forEach(h => {
    const tr = document.createElement('tr');
    const resultClass = h.result >= 0 ? 'pos' : 'neg';
    tr.innerHTML = `
      <td class="item-name">${h.item}</td>
      <td>${fmtNum(h.buyPrice)}</td>
      <td>${h.sellPrice !== null ? fmtNum(h.sellPrice) : '—'}</td>
      <td>${fmtNum(h.qty)}</td>
      <td class="${resultClass}" style="font-weight:600;">${fmtCoins(h.result)}</td>
      <td><span class="badge ${h.status === 'closed' ? 'closed' : 'cancelled'}">${h.status === 'closed' ? 'Clôturé' : 'Annulé'}</span></td>
      <td class="muted">${h.closedAt}</td>
    `;
    hBody.appendChild(tr);
  });
}

async function addTrade(){
  if(!currentProfile) return;
  const itemInput = document.getElementById('itemInput');
  const buyPriceInput = document.getElementById('buyPrice');
  const qtyInput = document.getElementById('qty');
  const pendingCheckbox = document.getElementById('isPendingOrder');

  const item = itemInput.value.trim();
  const buyPrice = parseFloat(buyPriceInput.value);
  const qty = parseInt(qtyInput.value, 10);

  if(!item){ itemInput.focus(); return; }
  if(!(buyPrice > 0)){ buyPriceInput.focus(); return; }
  if(!(qty > 0)){ qtyInput.focus(); return; }

  if(pendingCheckbox.checked){
    buyOrders.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      item, buyPrice, qty,
      openedAt: nowLabel()
    });
  } else {
    trades.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      item, buyPrice, qty,
      openedAt: nowLabel()
    });
  }

  await saveProfileData();
  render();

  itemInput.value = '';
  buyPriceInput.value = '';
  qtyInput.value = '';
  pendingCheckbox.checked = false;
  document.getElementById('itemHint').innerHTML = '&nbsp;';
  itemInput.focus();
}

/* ---------------- Buy Orders en cours ---------------- */

// Compare le prix de notre Buy Order au carnet d'ordres (buy_summary) de
// l'API pour estimer sa position : Top 1 (meilleur prix), ou quantité totale
// qui doit se vendre avant que notre ordre ait une chance d'être rempli.
function computeQueueInfo(item, orderPrice){
  const match = bazaarMap[item.toLowerCase()];
  if(!match || !match.buyOrderBook || !match.buyOrderBook.length){
    return { known: false };
  }
  const EPS = Math.max(0.01, orderPrice * 0.0005); // tolérance d'arrondi
  let ahead = 0;
  let sameLevelAmount = 0;

  match.buyOrderBook.forEach(level => {
    if(level.price > orderPrice + EPS){
      ahead += level.amount;
    } else if(Math.abs(level.price - orderPrice) <= EPS){
      sameLevelAmount += level.amount;
    }
  });

  return { known: true, ahead, sameLevelAmount, isTop: ahead === 0 };
}

function queueInfoLabel(item, orderPrice){
  const info = computeQueueInfo(item, orderPrice);
  if(!info.known) return '<span class="muted">—</span>';
  if(info.isTop && info.sameLevelAmount === 0){
    return '<span class="queue-top">🥇 Top 1</span>';
  }
  if(info.isTop && info.sameLevelAmount > 0){
    return `<span class="queue-top">🥇 Meilleur prix</span><br><span class="muted" style="font-size:9.5px;">+ ${fmtNum(info.sameLevelAmount)} au même prix</span>`;
  }
  let label = `<span class="queue-wait">~${fmtNum(info.ahead)} devant vous</span>`;
  if(info.sameLevelAmount > 0){
    label += `<br><span class="muted" style="font-size:9.5px;">+ ${fmtNum(info.sameLevelAmount)} au même prix</span>`;
  }
  return label;
}

function renderBuyOrders(){
  const body = document.getElementById('buyOrdersBody');
  const empty = document.getElementById('buyOrdersEmpty');
  if(!body) return; // sécurité si l'élément n'existe pas encore

  body.innerHTML = '';
  empty.style.display = buyOrders.length ? 'none' : 'block';

  buyOrders.forEach(o => {
    const tr = document.createElement('tr');
    tr.dataset.id = o.id;
    const match = bazaarMap[o.item.toLowerCase()];
    const currentPrice = match ? match.buy : null;
    const latent = currentPrice !== null ? (currentPrice - o.buyPrice) * o.qty : null;
    const latentClass = latent === null ? 'muted' : (latent >= 0 ? 'latent-pos' : 'latent-neg');
    const latentLabel = latent === null ? '—' : fmtCoins(latent);

    tr.innerHTML = `
      <td class="item-name">${o.item}</td>
      <td>${fmtNum(o.buyPrice)}</td>
      <td>${fmtNum(o.qty)}</td>
      <td>${fmtNum(o.buyPrice * o.qty)}</td>
      <td class="${latentClass}">${latentLabel}</td>
      <td class="muted">${o.openedAt}</td>
      <td>${queueInfoLabel(o.item, o.buyPrice)}</td>
      <td>
        <div class="row-actions">
          <button class="ok" data-order-action="fill" data-order-id="${o.id}">Rempli → Trade</button>
          <button class="danger" data-order-action="cancel" data-order-id="${o.id}">Annuler</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

async function fillBuyOrder(id){
  const idx = buyOrders.findIndex(o => o.id === id);
  if(idx === -1) return;
  const o = buyOrders[idx];

  trades.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    item: o.item, buyPrice: o.buyPrice, qty: o.qty,
    openedAt: o.openedAt
  });
  buyOrders.splice(idx, 1);

  await saveProfileData();
  render();
}

async function cancelBuyOrder(id){
  const o = buyOrders.find(x => x.id === id);
  if(!o) return;
  if(!confirm(`Annuler le Buy Order "${o.item}" ? Il sera simplement retiré (aucun coin n'a encore été dépensé).`)) return;

  buyOrders = buyOrders.filter(x => x.id !== id);
  await saveProfileData();
  render();
}

document.getElementById('buyOrdersBody').addEventListener('click', e => {
  const btn = e.target.closest('button[data-order-action]');
  if(!btn) return;
  const { orderAction, orderId } = btn.dataset;
  if(orderAction === 'fill') fillBuyOrder(orderId);
  else if(orderAction === 'cancel') cancelBuyOrder(orderId);
});

function startClose(id){
  editingRowOpen = true;
  const t = trades.find(t => t.id === id);
  if(!t) return;
  const cell = document.getElementById(`actions-${id}`);
  cell.innerHTML = `
    <div class="close-form">
      <input type="number" step="1" min="1" max="${t.qty}" value="${t.qty}" placeholder="Qté à vendre" id="sellQty-${id}">
      <input type="number" step="0.1" min="0" placeholder="Prix de vente" id="sellPrice-${id}">
      <button class="ok" data-action="confirm-close" data-id="${id}">Valider</button>
      <button class="ghost" data-action="abort-close" data-id="${id}">Retour</button>
    </div>
  `;
  document.getElementById(`sellPrice-${id}`).focus();
}

async function confirmClose(id){
  const qtyInput = document.getElementById(`sellQty-${id}`);
  const priceInput = document.getElementById(`sellPrice-${id}`);
  const sellPrice = parseFloat(priceInput.value);

  const idx = trades.findIndex(t => t.id === id);
  if(idx === -1) return;
  const t = trades[idx];

  let sellQty = parseInt(qtyInput.value, 10);
  if(!(sellPrice >= 0)){ priceInput.focus(); return; }
  if(!(sellQty > 0)){ qtyInput.focus(); return; }
  if(sellQty > t.qty) sellQty = t.qty;

  const result = (sellPrice - t.buyPrice) * sellQty;

  history.push({
    item: t.item, buyPrice: t.buyPrice, sellPrice, qty: sellQty,
    result, status: 'closed', closedAt: nowLabel()
  });

  if(sellQty >= t.qty){
    trades.splice(idx, 1); // position entièrement vendue
  } else {
    t.qty -= sellQty; // le reste de la position reste en cours
  }

  editingRowOpen = false;
  await saveProfileData();
  render();
  flashPurse(result >= 0);
}

document.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const { action, id } = btn.dataset;
  if(action === 'close') startClose(id);
  else if(action === 'confirm-close') confirmClose(id);
  else if(action === 'abort-close'){ editingRowOpen = false; render(); }
});

document.getElementById('addTrade').addEventListener('click', addTrade);
[document.getElementById('buyPrice'), document.getElementById('qty')].forEach(el => {
  el.addEventListener('keydown', e => { if(e.key === 'Enter') addTrade(); });
});

document.getElementById('itemInput').addEventListener('input', e => {
  const match = bazaarMap[e.target.value.trim().toLowerCase()];
  const hint = document.getElementById('itemHint');
  hint.innerHTML = match
    ? `Bazaar actuel — achat instantané : <b>${fmtNum(match.buy)}</b> · vente instantanée : <b>${fmtNum(match.sell)}</b>`
    : '&nbsp;';
});

document.getElementById('resetAll').addEventListener('click', async () => {
  if(!currentProfile) return;
  if(!confirm(`Supprimer tous les trades et l'historique du profil "${currentProfile}" ? Cette action est irréversible.`)) return;
  trades = [];
  history = [];
  await saveProfileData();
  render();
});

document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importInput').click();
});
document.getElementById('importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if(file) await importData(file);
  e.target.value = '';
});

/* ---------------- Favoris ---------------- */

// Compatibilité : d'anciens favoris peuvent être de simples chaînes ("Nom")
// ou d'anciens objets { name, alert } (seuil d'achat uniquement).
// On les normalise en { name, buyAlert, sellAlert }.
function normalizeFavorite(f){
  if(typeof f === 'string') return { name: f, buyAlert: null, sellAlert: null };
  const buyAlert = typeof f.buyAlert === 'number' ? f.buyAlert : (typeof f.alert === 'number' ? f.alert : null);
  const sellAlert = typeof f.sellAlert === 'number' ? f.sellAlert : null;
  return { name: f.name, buyAlert, sellAlert };
}

// Icône d'item : tentative via les textures Minecraft vanilla (GitHub, gratuit,
// sans clé). Ça fonctionne pour les items basés sur du vanilla (blocs, lingots,
// minerais...) mais pas pour les items 100% custom à Skyblock (ex: Kuudra Teeth) —
// dans ce cas l'image échoue simplement et on affiche un petit 📦 à la place.
const TEXTURE_BASE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.1/assets/minecraft/textures';
function guessTextureName(itemId){
  return itemId.replace(/^ENCHANTED_/, '').toLowerCase();
}
function favIconHtml(itemId){
  const guess = guessTextureName(itemId);
  return `<img class="fav-icon" src="${TEXTURE_BASE}/block/${guess}.png"
    data-fallback="${TEXTURE_BASE}/item/${guess}.png"
    onerror="faviconFallback(this)">`;
}
function faviconFallback(img){
  if(img.dataset.fallback){
    const next = img.dataset.fallback;
    img.dataset.fallback = '';
    img.src = next;
  } else {
    img.replaceWith(Object.assign(document.createElement('span'), {className: 'fav-icon fav-icon-generic', textContent: '📦'}));
  }
}
window.faviconFallback = faviconFallback;

function renderFavorites(){
  const list = document.getElementById('favList');
  const empty = document.getElementById('favEmpty');
  list.innerHTML = '';
  empty.style.display = favorites.length ? 'none' : 'block';

  favorites.forEach(fRaw => {
    const f = normalizeFavorite(fRaw);
    const match = bazaarMap[f.name.toLowerCase()];
    const buyPrice = match ? match.buy : null;
    const sellPrice = match ? match.sell : null;
    const buyHit = f.buyAlert !== null && buyPrice !== null && buyPrice <= f.buyAlert;
    const sellHit = f.sellAlert !== null && sellPrice !== null && sellPrice >= f.sellAlert;
    const itemId = match ? match.id : f.name.replace(/ /g, '_').toUpperCase();

    const row = document.createElement('div');
    row.className = 'fav-item';
    row.innerHTML = `
      <div class="fav-top">
        ${favIconHtml(itemId)}
        <span class="fav-name">${f.name}</span>
        <button class="fav-remove" data-fav-remove="${f.name}">×</button>
      </div>
      <div class="fav-line ${buyHit ? 'fav-hit-buy' : ''}">
        <span>${buyHit ? '▼ ' : ''}Sell Order ${buyPrice !== null ? fmtNum(buyPrice) : '…'}</span>
        <span class="fav-alert-label" data-fav-alert="${f.name}" data-fav-alert-type="buy" title="Alerte à l'achat (vert si en dessous)">
          ${f.buyAlert !== null ? '🔔 ' + fmtNum(f.buyAlert) : '🔔'}
        </span>
      </div>
      <div class="fav-line ${sellHit ? 'fav-hit-sell' : ''}">
        <span>${sellHit ? '▲ ' : ''}Buy Order ${sellPrice !== null ? fmtNum(sellPrice) : '…'}</span>
        <span class="fav-alert-label" data-fav-alert="${f.name}" data-fav-alert-type="sell" title="Alerte à la vente (rouge si au dessus)">
          ${f.sellAlert !== null ? '🔔 ' + fmtNum(f.sellAlert) : '🔔'}
        </span>
      </div>
    `;
    list.appendChild(row);
  });
}

async function addFavorite(name){
  name = name.trim();
  if(!name || !currentProfile) return;
  favorites = favorites.map(normalizeFavorite);
  if(!favorites.find(f => f.name.toLowerCase() === name.toLowerCase())){
    favorites.push({ name, buyAlert: null, sellAlert: null });
    await saveProfileData();
    renderFavorites();
  }
  document.getElementById('favInput').value = '';
}

async function setFavoriteAlert(name, type){
  favorites = favorites.map(normalizeFavorite);
  const fav = favorites.find(f => f.name === name);
  if(!fav) return;

  const field = type === 'sell' ? 'sellAlert' : 'buyAlert';
  const label = type === 'sell' ? 'vente' : 'achat';
  const hint = type === 'sell'
    ? "prix au-dessus duquel c'est intéressant de vendre"
    : "prix en dessous duquel c'est intéressant d'acheter";

  const current = fav[field] !== null ? fav[field] : '';
  const input = prompt(`Prix d'alerte à la ${label} pour "${name}" (${hint}) :\nLaisse vide pour retirer l'alerte.`, current);
  if(input === null) return; // annulé

  const trimmed = input.trim();
  if(trimmed === ''){
    fav[field] = null;
  } else {
    const val = parseFloat(trimmed.replace(',', '.'));
    if(!(val > 0)){ alert('Entre un nombre valide.'); return; }
    fav[field] = val;
  }
  await saveProfileData();
  renderFavorites();
}

document.getElementById('favAddBtn').addEventListener('click', () => {
  addFavorite(document.getElementById('favInput').value);
});
document.getElementById('favInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') addFavorite(e.target.value);
});
document.getElementById('favList').addEventListener('click', async e => {
  const removeBtn = e.target.closest('button[data-fav-remove]');
  const alertLabel = e.target.closest('[data-fav-alert]');

  if(removeBtn){
    const name = removeBtn.dataset.favRemove;
    favorites = favorites.map(normalizeFavorite).filter(f => f.name !== name);
    await saveProfileData();
    renderFavorites();
    return;
  }
  if(alertLabel){
    await setFavoriteAlert(alertLabel.dataset.favAlert, alertLabel.dataset.favAlertType);
  }
});

/* ---------------- Prix bazaar ---------------- */

async function loadBazaar(){
  const hint = document.getElementById('refreshHint');
  try{
    hint.innerHTML = 'Chargement des prix bazaar...';
    const res = await fetch('https://api.hypixel.net/v2/skyblock/bazaar');
    const data = await res.json();
    if(!data.success) throw new Error('API indisponible');

    bazaarMap = {};
    const datalist = document.getElementById('itemsList');
    datalist.innerHTML = '';
    const frag = document.createDocumentFragment();

    Object.keys(data.products).forEach(id => {
      const p = data.products[id];
      const name = humanize(id);
      bazaarMap[name.toLowerCase()] = {
        id,
        buy: p.quick_status ? p.quick_status.buyPrice : 0,
        sell: p.quick_status ? p.quick_status.sellPrice : 0,
        buyOrderBook: Array.isArray(p.buy_summary) ? p.buy_summary : []
      };
      const opt = document.createElement('option');
      opt.value = name;
      frag.appendChild(opt);
    });
    datalist.appendChild(frag);

    hint.innerHTML = `Prix bazaar chargés à l'instant (${nowLabel()}). <button class="ghost" id="refreshPrices" style="padding:2px 8px;font-size:11px;">Actualiser</button>`;
    document.getElementById('refreshPrices').addEventListener('click', loadBazaar);
    render();
    renderBuyOrders();
    renderFavorites();
  }catch(err){
    hint.innerHTML = `Impossible de charger les prix bazaar (hors-ligne ou API bloquée). L'ajout de trades reste possible manuellement. <button class="ghost" id="refreshPrices" style="padding:2px 8px;font-size:11px;">Réessayer</button>`;
    document.getElementById('refreshPrices').addEventListener('click', loadBazaar);
  }
}

document.getElementById('refreshPrices').addEventListener('click', loadBazaar);

/* ---------------- Initialisation ---------------- */

(async function init(){
  const fresh = await fetchStore();
  if(fresh) store = fresh;

  currentProfile = store.currentProfile || null;
  if(currentProfile && !store.profiles.find(p => p.name.toLowerCase() === currentProfile.toLowerCase())){
    currentProfile = null;
  }

  renderProfileChip();
  loadProfileData();
  render();
  renderFavorites();
  updateFileStatus();
  loadBazaar();

  if(!currentProfile){
    openModal(false);
  }

  setInterval(pollStore, 15000);
})();
