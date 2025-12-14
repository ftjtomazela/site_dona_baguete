import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase, ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAQTm3cL26REQloN8AFP28gwsIUzYz73og",
    authDomain: "dona-baguete-kds.firebaseapp.com",
    databaseURL: "https://dona-baguete-kds-default-rtdb.firebaseio.com",
    projectId: "dona-baguete-kds",
    storageBucket: "dona-baguete-kds.firebasestorage.app",
    messagingSenderId: "307283406823",
    appId: "1:307283406823:web:a7d1761f0b4550cae59742",
    measurementId: "G-NY4NTLFLCG"
};

const ENDERECO_LOJA = "Rua Romualdo Albino Balestrin, 35, CONCHAS, SP";
const WHATSAPP_LOJA = "5514991718704";
const FUNCTION_URL = "https://us-central1-dona-baguete-kds.cloudfunctions.net/processarPedido";
const CHAVE_PIX = "14981244230";

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const lanchesRef = ref(database, 'cardapio/lanches');
const bebidasRef = ref(database, 'cardapio/bebidas');

var lanches = [], bebidas = [], cart = [], currentLanche = null, currentBebida = null;
var freteAtual = 0, distanceMatrixService, autocompleteInstance = null;
let currentPixPayload = "", currentOrderData = null, currentOrderId = null, pixTimerInterval = null;

    var adicionais = [
        { id: 'bacon', nome: 'Bacon Extra', preco: 5.00 }, { id: 'queijo-prato', nome: 'Queijo Prato Extra', preco: 4.00 },
        { id: 'queijo-mussarela', nome: 'Queijo Mussarela Extra', preco: 4.00 }, { id: 'catupiry', nome: 'Catupiry Extra', preco: 5.00 },
        { id: 'repolho-maionese', nome: 'Repolho com Maionese', preco: 2.00 }
    ];
    var remocoes = [
        { id: 'sem-bacon', nome: 'Sem Bacon', ingredienteId: 'bacon' }, { id: 'sem-queijo', nome: 'Sem Queijo', ingredienteId: 'queijo' },
        { id: 'sem-catupiry', nome: 'Sem Catupiry', ingredienteId: 'catupiry' }, { id: 'sem-tomate', nome: 'Sem Vinagrete', ingredienteId: 'tomate' },
        { id: 'sem-maionese', nome: 'Sem Maionese', ingredienteId: 'maionese' }, { id: 'sem-repolho-maionese', nome: 'Sem Repolho c/ Maionese', ingredienteId: 'repolho-maionese' },
        { id: 'sem-rucula', nome: 'Sem Rúcula', ingredienteId: 'rucula' }
    ];

// --- MAPAS ---
function initMap() { if (window.google && window.google.maps) distanceMatrixService = new google.maps.DistanceMatrixService(); }

function initAutocomplete() {
    const inputRua = document.getElementById('endereco-rua');
    if (!inputRua || !window.google || !window.google.maps || !window.google.maps.places) return;
    if (autocompleteInstance) return;

    try {
        autocompleteInstance = new google.maps.places.Autocomplete(inputRua, {
            types: ['geocode'], componentRestrictions: { country: 'br' },
            fields: ["address_components", "geometry", "name"]
        });
        autocompleteInstance.addListener('place_changed', function() {
            const place = autocompleteInstance.getPlace();
            if (!place.geometry) return;
            let rua = "", bairro = "", numero = "";
            place.address_components.forEach(c => {
                if (c.types.includes('route')) rua = c.long_name;
                if (c.types.includes('sublocality')) bairro = c.long_name;
                if (c.types.includes('street_number')) numero = c.long_name;
            });
            document.getElementById('endereco-rua').value = rua;
            document.getElementById('endereco-bairro').value = bairro;
            document.getElementById('endereco-numero').value = numero;
            document.getElementById('endereco-numero').focus();
            updateCart();
        });
    } catch (e) { console.warn("Erro mapa:", e); }
}

async function calculateDeliveryFee(destino) {
    return new Promise((resolve, reject) => {
        if (!window.google || !window.google.maps) return reject(new Error("Erro Maps"));
        if (!distanceMatrixService) distanceMatrixService = new google.maps.DistanceMatrixService();
        distanceMatrixService.getDistanceMatrix({ origins: [ENDERECO_LOJA], destinations: [destino], travelMode: 'DRIVING' }, (res, status) => {
            if (status === 'OK' && res.rows[0].elements[0].status === 'OK') {
                const km = res.rows[0].elements[0].distance.value / 1000;
                if (km <= 3) resolve(4.00); else if (km <= 6) resolve(5.00); else resolve(10.00);
            } else { reject(new Error("Endereço não encontrado")); }
        });
    });
}

// --- CARDÁPIO ---

// --- CARDÁPIO ---
async function carregarCardapio() {
    try {
        const [ls, bs] = await Promise.all([get(lanchesRef), get(bebidasRef)]);
        lanches = []; bebidas = [];
        
        // Pega os dados do Firebase
        if (ls.exists()) ls.forEach(c => { const i=c.val(); if(!i.pausado) { i.id=c.key; lanches.push(i); } });
        if (bs.exists()) bs.forEach(c => { const i=c.val(); if(!i.pausado) { i.id=c.key; bebidas.push(i); } });
        
        // --- FILTRAGEM: SEPARA O QUE É COMBO DO QUE É LANCHE NORMAL ---
        const listaCombos = lanches.filter(l => l.nome.includes('Combo') || l.nome.includes('🔥'));
        const listaLanches = lanches.filter(l => !l.nome.includes('Combo') && !l.nome.includes('🔥'));

        // 1. RENDERIZA COMBOS (MAIS VENDIDOS)
        const divCombos = document.getElementById('combos-container'); 
        if(divCombos) {
            divCombos.innerHTML = '';
            if (listaCombos.length === 0) divCombos.innerHTML = "<p style='color:#888'>Sem destaques hoje.</p>";
            
            listaCombos.forEach(l => {
                divCombos.innerHTML += `
                <div class="menu-item" style="border: 2px solid #db0007;"> ${l.imagem ? `<img src="${l.imagem}" class="item-img">` : ''}
                    <div class="item-info">
                        <span class="nome">${l.nome}</span>
                        <span class="preco">R$ ${Number(l.preco).toFixed(2).replace('.',',')}</span>
                    </div>
                    <button class="btn-add" onclick="openModal('${l.id}')">ADICIONAR</button>
                </div>`;
            });
        }

        // 2. RENDERIZA LANCHES NORMAIS
        const divL = document.getElementById('lanches-container'); 
        if(divL) {
            divL.innerHTML = '';
            listaLanches.forEach(l => {
                divL.innerHTML += `
                <div class="menu-item">
                    ${l.imagem ? `<img src="${l.imagem}" class="item-img">` : ''}
                    <div class="item-info">
                        <span class="nome">${l.nome}</span>
                        <span class="preco">R$ ${Number(l.preco).toFixed(2).replace('.',',')}</span>
                    </div>
                    <button class="btn-add" onclick="openModal('${l.id}')">ADICIONAR</button>
                </div>`;
            });
        }
        
        // 3. RENDERIZA BEBIDAS
        const divB = document.getElementById('bebidas-container'); 
        if(divB) {
            divB.innerHTML = '';
            bebidas.forEach(b => {
                const acaoBotao = (b.sabores && b.sabores.length > 0) ? `openBebidaModal('${b.id}')` : `addBebidaToCart('${b.id}')`;
                divB.innerHTML += `
                <div class="menu-item">
                    ${b.imagem ? `<img src="${b.imagem}" class="item-img">` : ''}
                    <div class="item-info">
                        <span class="nome">${b.nome}</span>
                        <span class="preco">R$ ${Number(b.preco).toFixed(2).replace('.',',')}</span>
                    </div>
                    <button class="btn-add" onclick="${acaoBotao}">ADICIONAR</button>
                </div>`;
            });
        }
    } catch(e) { console.error("Erro ao carregar cardápio:", e); }
}

// --- MODAIS ---
function openModal(id) {
    currentLanche = lanches.find(l => l.id === id);
    if(!currentLanche) return;
    document.getElementById('modal-title').innerText = currentLanche.nome;
    document.getElementById('observacao').value = '';
    
    // Queijo
    const divQ = document.getElementById('tipo-queijo-section');
    const hasQ = (currentLanche.ingredientesBase||[]).includes('queijo');
    divQ.style.display = hasQ ? 'block' : 'none';
    if(hasQ) document.getElementById('tipo-queijo-container').innerHTML = `<div class="option-item"><input type="radio" name="queijo" value="Prato" checked onchange="updateModalTotal()"> <label>Prato</label></div><div class="option-item"><input type="radio" name="queijo" value="Mussarela" onchange="updateModalTotal()"> <label>Mussarela</label></div>`;

    // Adicionais
    document.getElementById('adicionais-container').innerHTML = adicionais.map(a => `<div class="option-item"><input type="checkbox" class="add-check" data-preco="${a.preco}" data-nome="${a.nome}" onchange="updateModalTotal()"> <label>${a.nome}</label> <span style="color:#f59e0b">+R$ ${a.preco.toFixed(2).replace('.',',')}</span></div>`).join('');
    
    // Remoções (CORRIGIDO)
    const divRem = document.getElementById('remocoes-container'); divRem.innerHTML = '';
    remocoes.forEach(r => {
        if((currentLanche.ingredientesBase||[]).includes(r.ingredienteId)) {
            divRem.innerHTML += `<div class="option-item"><input type="checkbox" class="rem-check" value="${r.nome}"> <label>${r.nome}</label></div>`;
        }
    });
    // Agora aponta para o ID correto que criamos no HTML
    document.getElementById('rem-section').style.display = divRem.innerHTML ? 'block' : 'none';

    updateModalTotal();
    document.getElementById('modal').classList.add('active');
};

function updateModalTotal() {
    let t = Number(currentLanche.preco);
    document.querySelectorAll('.add-check:checked').forEach(e => t += parseFloat(e.dataset.preco));
    document.getElementById('modal-total').innerText = 'R$ ' + t.toFixed(2).replace('.',',');
};

function addLancheToCart() {
    if(!currentLanche) return;
    const ads = Array.from(document.querySelectorAll('.add-check:checked')).map(e => ({ nome: e.dataset.nome, preco: parseFloat(e.dataset.preco) }));
    const rems = Array.from(document.querySelectorAll('.rem-check:checked')).map(e => ({ nome: e.value }));
    const obs = document.getElementById('observacao').value;
    let queijo = null;
    if(document.getElementById('tipo-queijo-section').style.display !== 'none') {
        const q = document.querySelector('input[name="queijo"]:checked');
        if(q) queijo = q.value;
    }
    let total = Number(currentLanche.preco) + ads.reduce((a,b)=>a+b.preco,0);
    cart.push({ cartId: Date.now(), id: currentLanche.id, tipo: 'lanches', nome: currentLanche.nome, precoTotal: total, quantidade: 1, queijo, adicionais: ads, remocoes: rems, observacao: obs });
    document.getElementById('modal').classList.remove('active');
    updateCart();
};

function addBebidaToCart(id) {
    const b = bebidas.find(i => i.id === id);
    if(b) {
        cart.push({ cartId: Date.now(), id: b.id, tipo: 'bebidas', nome: b.nome, precoTotal: Number(b.preco), quantidade: 1 });
        updateCart();
    }
};

function openBebidaModal(id) {
    currentBebida = bebidas.find(b => b.id === id);
    document.getElementById('bebida-modal-title').innerText = currentBebida.nome;
    document.getElementById('obs-bebida').value = '';
    document.getElementById('sabores-container').innerHTML = currentBebida.sabores.map((s,i) => `<div class="option-item"><input type="radio" name="sabor-bebida" value="${s}" id="s-${i}" ${i===0?'checked':''}><label for="s-${i}">${s}</label></div>`).join('');
    document.getElementById('bebida-modal').classList.add('active');
}
function closeBebidaModal() { document.getElementById('bebida-modal').classList.remove('active'); }
function addBebidaFromModal() {
    const s = document.querySelector('input[name="sabor-bebida"]:checked').value;
    cart.push({ cartId: Date.now(), id: currentBebida.id, tipo: 'bebidas', nome: currentBebida.nome, precoTotal: Number(currentBebida.preco), quantidade: 1, sabor: s, observacao: document.getElementById('obs-bebida').value });
    closeBebidaModal();
    updateCart();
}

function removeFromCart(id) { cart = cart.filter(i => i.cartId !== id); updateCart(); };
// 👇 COLE AQUI A NOVA FUNÇÃO 👇
window.limparCarrinho = function() {
    if(confirm("Tem certeza que deseja esvaziar todo o carrinho?")) {
        cart = []; // Zera a lista de itens
        updateCart(); // Atualiza a tela para mostrar vazio
    }
}
// 👆 FIM DA NOVA FUNÇÃO 👆
function openCart() {
    loadClientData();
    updateCart();
    document.getElementById('cart-modal').classList.add('active');
    setTimeout(() => { if(window.initAutocomplete) window.initAutocomplete(); }, 500); 
};
function closeCart() { document.getElementById('cart-modal').classList.remove('active'); }

async function updateCart() {
    localStorage.setItem('carrinho_salvo', JSON.stringify(cart));
    const div = document.getElementById('cart-items-container');
    div.innerHTML = '';
    document.getElementById('cart-count').innerText = cart.length;
    const btn = document.getElementById('btn-submit-order');
    
    if(cart.length === 0) {
        div.innerHTML = '<p style="text-align:center; color:#888;">Vazio</p>';
        btn.disabled = true;
    } else {
        btn.disabled = false;
        cart.forEach(i => {
            let desc = [];
            if(i.queijo) desc.push(`🧀 ${i.queijo}`);
            if(i.adicionais) i.adicionais.forEach(a => desc.push(`+ ${a.nome}`));
            if(i.remocoes) i.remocoes.forEach(r => desc.push(`- Sem ${r.nome}`));
            if(i.sabor) desc.push(`Sabor: ${i.sabor}`);
            if(i.observacao) desc.push(`📝 ${i.observacao}`);
            div.innerHTML += `<div class="cart-item"><div><b>${i.quantidade}x ${i.nome}</b><div style="font-size:0.8rem; color:#ccc;">${desc.join(', ')}</div></div><div style="display:flex; align-items:center; gap:10px;"><span style="color:#f59e0b;">R$ ${i.precoTotal.toFixed(2).replace('.',',')}</span><button class="cart-item-remove" onclick="removeFromCart(${i.cartId})">✕</button></div></div>`;
        });
    }

    const tipo = document.getElementById('localidade').value;
    const divEnd = document.getElementById('endereco-inputs');
    divEnd.style.display = (tipo === 'entrega') ? 'block' : 'none';
    
    if(tipo === 'entrega') {
        const rua = document.getElementById('endereco-rua').value;
        const num = document.getElementById('endereco-numero').value;
        if(rua && num) {
            document.getElementById('frete-calculando').style.display = 'block';
            document.getElementById('frete-calculando').innerText = 'Calculando frete...';
            btn.disabled = true;
            try {
                freteAtual = await calculateDeliveryFee(`${rua}, ${num}, Conchas, SP`);
                document.getElementById('frete-calculando').style.display = 'none';
                btn.disabled = false;
            } catch(e) {
                freteAtual = 0;
                document.getElementById('frete-calculando').innerText = "Endereço não encontrado.";
            }
        } else {
            freteAtual = 0;
            if(cart.length > 0) btn.disabled = true;
        }
    } else {
        freteAtual = 0;
        document.getElementById('frete-calculando').style.display = 'none';
        if(cart.length > 0) btn.disabled = false;
    }

    const sub = cart.reduce((a,b)=>a+b.precoTotal,0);
    document.getElementById('cart-subtotal').innerText = 'R$ ' + sub.toFixed(2).replace('.',',');
    document.getElementById('cart-taxa').innerText = 'R$ ' + freteAtual.toFixed(2).replace('.',',');
    document.getElementById('cart-total-in-summary').innerText = 'R$ ' + (sub+freteAtual).toFixed(2).replace('.',',');
    togglePaymentDetails(document.getElementById('pagamento').value);
}

function togglePaymentDetails(val) { document.getElementById('troco-section').style.display = (val === 'dinheiro') ? 'block' : 'none'; };

document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-order');
    btn.disabled = true; btn.innerText = "Processando...";
    const nome = document.getElementById('cliente-nome').value;
    let whats = document.getElementById('cliente-whatsapp').value.replace(/\D/g,'');
    if(whats.length < 12) whats = "55" + whats;
    const pag = document.getElementById('pagamento').value;
    const total = cart.reduce((a,b)=>a+b.precoTotal,0) + freteAtual;

    const pedido = {
        cliente: { nome, whatsapp: whats },
        itens: cart,
        entrega: {
            tipo: document.getElementById('localidade').value,
            endereco: document.getElementById('localidade').value === 'entrega' ? `${document.getElementById('endereco-rua').value}, ${document.getElementById('endereco-numero').value}` : 'Retirada',
            taxa: freteAtual
        },
        pagamento: (pag === 'pix') ? 'PIX' : (pag === 'mercadopago' ? 'Mercado Pago' : pag),
        total: total,
        status: 'Aguardando Pagamento',
        hora: new Date().toISOString()
    };

    try {
        const res = await fetch(FUNCTION_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: pedido })
        });
        const result = await res.json();
        const data = result.result;
        currentOrderData = pedido;
        currentOrderId = data.pedidoId;

        if(pag === 'pix') {
            document.getElementById('cart-modal').classList.remove('active');
            document.getElementById('pix-payload-input').value = data.pixPayload;
            document.getElementById('pix-qr-code').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.pixPayload)}`;
            document.getElementById('checkout-pix-total').innerText = 'R$ ' + total.toFixed(2).replace('.',',');
            document.getElementById('pix-payment-modal').classList.add('active');
            monitorarPagamento(data.pedidoId);
            startTimer();
        } else {
            finalizeOrder();
        }
    } catch(err) {
        alert("Erro: " + err.message);
        btn.disabled = false; btn.innerText = "FINALIZAR PEDIDO";
    }
});

function monitorarPagamento(id) {
    onValue(ref(database, `pedidos/${id}`), (snap) => {
        const p = snap.val();
        if(p && p.status === 'Pendente') {
            const el = document.getElementById('status-agurdando');
            el.innerHTML = '<h3 style="color:#10b981">PAGAMENTO CONFIRMADO!</h3>';
            el.style.borderColor = '#10b981';
            el.style.background = 'rgba(16,185,129,0.2)';
            el.style.animation = 'none';
            setTimeout(finalizeOrder, 2000);
        }
    });
}

function finalizeOrder() {
    let msg = `*NOVO PEDIDO #${currentOrderId.substring(1)}*\n`;
    msg += `Cliente: ${currentOrderData.cliente.nome}\n`;
    currentOrderData.itens.forEach(i => msg += `${i.quantidade}x ${i.nome}\n`);
    msg += `Total: R$ ${currentOrderData.total.toFixed(2)}\n`;
    msg += `Pagamento: ${currentOrderData.pagamento}\n`;
    msg += `Entrega: ${currentOrderData.entrega.endereco}`;
    window.open(`https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent(msg)}`, '_blank');
    cart = []; updateCart();
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    document.getElementById('success-modal').classList.add('active');
};

function closeSuccessModal() { location.reload(); }
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); }
function closePixCheckout() { document.getElementById('pix-payment-modal').classList.remove('active'); if(pixTimerInterval) clearInterval(pixTimerInterval); };
function copyPixPayload() { navigator.clipboard.writeText(document.getElementById('pix-payload-input').value).then(() => alert("Copiado!")); };
function saveClientData() { localStorage.setItem('cli_nome', document.getElementById('cliente-nome').value); localStorage.setItem('cli_tel', document.getElementById('cliente-whatsapp').value); };
function loadClientData() { if(localStorage.getItem('cli_nome')) document.getElementById('cliente-nome').value = localStorage.getItem('cli_nome'); if(localStorage.getItem('cli_tel')) document.getElementById('cliente-whatsapp').value = localStorage.getItem('cli_tel'); };

function startTimer() {
    let t = 600;
    if(pixTimerInterval) clearInterval(pixTimerInterval);
    pixTimerInterval = setInterval(() => {
        let m = Math.floor(t/60), s = t%60;
        document.getElementById('pix-timer').innerText = `${m}:${s<10?'0'+s:s}`;
        if(--t < 0) clearInterval(pixTimerInterval);
    }, 1000);
}

// EXPORTA AS FUNÇÕES
window.initMap = initMap;
window.initAutocomplete = initAutocomplete;
window.openModal = openModal;
window.updateModalTotal = updateModalTotal;
window.addLancheToCart = addLancheToCart;
window.addBebidaToCart = addBebidaToCart;
window.openBebidaModal = openBebidaModal;
window.closeBebidaModal = closeBebidaModal;
window.addBebidaFromModal = addBebidaFromModal;
window.removeFromCart = removeFromCart;
window.openCart = openCart;
window.closeCart = closeCart;
window.updateCart = updateCart;
window.togglePaymentDetails = togglePaymentDetails;
window.closeSuccessModal = closeSuccessModal;
window.closeModal = closeModal;
window.closePixCheckout = closePixCheckout;
window.copyPixPayload = copyPixPayload;
window.saveClientData = saveClientData;
window.onload = carregarCardapio;

function verificarHorario() {
    const data = new Date();
    const hora = data.getHours();
    
    // Configuração: Abre as 18h e fecha as 23h
    const aberto = hora >= 10 && hora <= 23; 

    if (!aberto) {
        // Mostra o aviso vermelho
        const aviso = document.getElementById('aviso-fechado');
        if(aviso) aviso.style.display = 'block';
        
        // Bloqueia os botões (Tenta a cada 1 segundo para garantir que os itens carregaram)
        setInterval(() => {
            const botoes = document.querySelectorAll('.btn-add');
            botoes.forEach(btn => {
                btn.disabled = true;
                btn.innerText = "FECHADO";
                btn.style.background = "#555";
                btn.style.cursor = "not-allowed";
            });
        }, 1000);
    }
}

// --- O NOVO GERENTE (FAZ TUDO) ---
window.onload = function() {
    console.log("Site carregou! Iniciando tarefas...");

    // 1. Carrega os lanches
    carregarCardapio();
    
    // 2. Verifica se a loja está aberta
    verificarHorario();
    
    // 3. Recupera carrinho (se existir)
    if (typeof recuperarCarrinho === 'function') {
        recuperarCarrinho();
    }
};


