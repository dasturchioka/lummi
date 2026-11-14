/* Admin Home mockup: one render from (role, language, state). Demo data only; the real numbers
   come from the API (queues) and from #42's sales service (the owner's strip). */
const P = new URLSearchParams(location.search);
const S = {
  role: P.get('role') || 'owner',
  lang: P.get('lang') || 'ru',
  state: P.get('state') || 'normal',
  view: P.get('view') || 'desktop',
  tick: 0,
};
if (P.get('shot')) document.body.classList.add('shot');

const I = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const money = (n, lang) =>
  n.toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ' + (lang === 'uz' ? 'soʻm' : 'сум');
const hm = (min) => `12:${String(28 + min).padStart(2, '0')}`;

/* Demo daily sales, thousands of so'm, oldest first; the last day is today (1 284 000). */
const DAYS = [612, 845, 498, 1030, 720, 905, 664, 1180, 830, 940, 1062, 745, 1290, 1284];

const NAV = [
  [null, [['home', 'house', 'all']]],
  ['sales', [['orders', 'shopping-bag', 'all'], ['credits', 'banknote-arrow-down', 'all'], ['btsPoints', 'map-pin', 'all'], ['customers', 'users', 'all'], ['reviews', 'message-square-text', 'all']]],
  ['shop', [['catalog', 'droplet', 'owner'], ['stock', 'warehouse', 'all'], ['sets', 'package', 'all'], ['content', 'file-text', 'owner']]],
  ['marketing', [['promoCodes', 'ticket-percent', 'owner'], ['campaignLinks', 'link-2', 'owner'], ['broadcasts', 'megaphone', 'owner']]],
  ['manage', [['reports', 'chart-column', 'owner'], ['shopCard', 'credit-card', 'owner'], ['settings', 'sliders-horizontal', 'owner'], ['audit', 'scroll-text', 'owner'], ['staff', 'user-cog', 'owner']]],
];

const T = {
  ru: {
    title: 'Главная',
    sub: (m) => `Пятница, 14 ноября · обновлено в ${hm(m)}`,
    subBare: 'Пятница, 14 ноября',
    groups: { sales: 'Продажи', shop: 'Магазин', marketing: 'Маркетинг', manage: 'Управление' },
    nav: { home: 'Главная', orders: 'Заказы', credits: 'Поступления', btsPoints: 'Пункты BTS', customers: 'Клиенты', reviews: 'Отзывы', catalog: 'Каталог', stock: 'Склад', sets: 'Наборы', content: 'Контент', promoCodes: 'Промокоды', campaignLinks: 'Ссылки кампаний', broadcasts: 'Рассылки', reports: 'Отчёты', settings: 'Настройки', shopCard: 'Карта для оплаты', staff: 'Сотрудники', audit: 'Журнал действий' },
    roles: { owner: 'Владелец', manager: 'Менеджер' },
    sales: 'Продажи сегодня',
    vs: 'в сравнении с прошлой пятницей',
    reports: 'Отчёты',
    barsL: ['14 дней', 'сегодня'],
    barsAria: (L) => `Выручка по дням за 14 дней; сегодня ${money(1284000, L)}`,
    figs: (L) => [
      ['Заказы', '7', '+2'],
      ['Выручка', money(1284000, L), '+18 %'],
      ['Средний чек', money(183400, L), '+9 %'],
      ['За 7 дней', money(6912000, L), '+6 % к прошлой неделе'],
    ],
    now: {
      receipt: {
        h: 'Чек к заказу № 1004 ждёт решения',
        facts: 'Ali Karimov · к оплате <b class="tnum">174 000 сум</b> · поступление <b class="tnum">174 000 сум</b> в 12:15 на *9860',
        why: 'ИИ не подтвердил: на чеке нет даты и времени перевода. Сверьте чек с поступлением и подтвердите оплату.',
        all: 'Все чеки · 1', open: 'Открыть заказ',
        wait: (m) => `ждёт ${m} мин`, end: 'в 15 мин — сигнал владельцу', sent: 'владельцу отправлен сигнал',
      },
      accept: {
        h: 'Заказ № 1007 оплачен 41 мин назад — примите его',
        facts: 'Dilnoza Yusupova · <b class="tnum">244 000 сум</b> · Angels’ Share 50 мл × 1 · BTS, Самарканд',
        why: 'Оплату подтвердил ИИ в 11:48. После «Принят» покупатель получит сообщение.',
        all: 'Все к приёму · 4', open: 'Открыть заказ',
      },
      humo: {
        h: 'Humo молчит 34 мин — чеки не подтверждаются сами',
        facts: 'Последний сигнал в <b class="tnum">11:54</b>. Таймеры чеков на паузе, брони продлеваются.',
        why: 'Пока сигнала нет, проверяйте чеки вручную по поступлениям в приложении банка.',
        all: 'Поступления', open: 'Чеки на проверке · 2',
      },
      nocard: {
        h: 'Оплата закрыта: не указана карта для оплаты',
        facts: 'Покупатели видят «Оплата временно недоступна» и не могут оформить заказ.',
        open: 'Указать карту', note: 'Указать карту может только владелец — сообщите ему.',
      },
      clear: { h: 'Всё сделано', why: 'Новые чеки и заказы появятся здесь сами: страница обновляется каждые 30 секунд.' },
    },
    queue: 'В работе',
    rows: {
      receipts: ['Чеки на проверке', 'ИИ не подтвердил — решает менеджер'],
      accept: ['Принять', 'оплата подтверждена'],
      assemble: ['Собрать', 'заказ принят'],
      bts: ['Передать в BTS', 'собирается'],
      credits: ['Поступления без заказа', 'деньги пришли, чека нет'],
      refunds: ['Возврат денег', 'оплачен и отменён'],
      stock: ['Склад', 'нет в наличии · заканчивается'],
      reviews: ['Отзывы', 'ждут публикации'],
    },
    out: 'нет', low: 'мало',
    age: {
      receipts: (m) => `ждёт ${m} мин`, accept: 'самый ранний — 41 мин', assemble: 'с 10:05', bts: 'с вчера, 18:40',
      credits: (L) => money(60000, L) + ' в 09:49', stock: 'Blue Sapphire 30 мл и ещё 4', reviews: 'с вчера, 19:10',
    },
    sys: { ok: 'Humo: сигнал 27 с назад', bad: 'Humo: нет сигнала 34 мин', backup: 'Резервная копия: сегодня в 03:00', errors: 'Ошибок за сутки нет' },
    err: { b: 'Не удалось загрузить главную', p: 'Проверьте соединение и попробуйте ещё раз.', retry: 'Повторить' },
  },
  uz: {
    title: 'Bosh sahifa',
    sub: (m) => `14-noyabr, juma · ${hm(m)} da yangilandi`,
    subBare: '14-noyabr, juma',
    groups: { sales: 'Savdo', shop: 'Doʻkon', marketing: 'Marketing', manage: 'Boshqaruv' },
    nav: { home: 'Bosh sahifa', orders: 'Buyurtmalar', credits: 'Tushumlar', btsPoints: 'BTS punktlari', customers: 'Mijozlar', reviews: 'Sharhlar', catalog: 'Katalog', stock: 'Ombor', sets: 'Toʻplamlar', content: 'Kontent', promoCodes: 'Promokodlar', campaignLinks: 'Kampaniya havolalari', broadcasts: 'Ommaviy xabarlar', reports: 'Hisobotlar', settings: 'Sozlamalar', shopCard: 'Toʻlov kartasi', staff: 'Xodimlar', audit: 'Harakatlar jurnali' },
    roles: { owner: 'Egasi', manager: 'Menejer' },
    sales: 'Bugungi savdo',
    vs: 'oʻtgan juma bilan solishtirganda',
    reports: 'Hisobotlar',
    barsL: ['14 kun', 'bugun'],
    barsAria: (L) => `Soʻnggi 14 kunlik savdo; bugun ${money(1284000, L)}`,
    figs: (L) => [
      ['Buyurtmalar', '7', '+2'],
      ['Savdo summasi', money(1284000, L), '+18 %'],
      ['Oʻrtacha chek', money(183400, L), '+9 %'],
      ['7 kunda', money(6912000, L), 'oʻtgan haftadan +6 %'],
    ],
    now: {
      receipt: {
        h: '№ 1004 buyurtma cheki qaror kutmoqda',
        facts: 'Ali Karimov · toʻlov <b class="tnum">174 000 soʻm</b> · tushum <b class="tnum">174 000 soʻm</b>, 12:15, *9860',
        why: 'AI tasdiqlamadi: chekda oʻtkazma sanasi va vaqti yoʻq. Chekni tushum bilan solishtirib, toʻlovni tasdiqlang.',
        all: 'Barcha cheklar · 1', open: 'Buyurtmani ochish',
        wait: (m) => `${m} daqiqadan beri kutmoqda`, end: '15 daqiqada egasiga xabar ketadi', sent: 'egasiga xabar yuborildi',
      },
      accept: {
        h: '№ 1007 buyurtma 41 daqiqa oldin toʻlangan — qabul qiling',
        facts: 'Dilnoza Yusupova · <b class="tnum">244 000 soʻm</b> · Angels’ Share 50 ml × 1 · BTS, Samarqand',
        why: 'Toʻlovni AI 11:48 da tasdiqlagan. «Qabul qilindi»dan keyin xaridorga xabar boradi.',
        all: 'Qabul qilinadiganlar · 4', open: 'Buyurtmani ochish',
      },
      humo: {
        h: 'Humo 34 daqiqadan beri jim — cheklar oʻzi tasdiqlanmayapti',
        facts: 'Oxirgi signal <b class="tnum">11:54</b> da. Chek taymerlari pauzada, bronlar uzaytiriladi.',
        why: 'Signal kelguncha cheklarni bank ilovasidagi tushumlar boʻyicha qoʻlda tekshiring.',
        all: 'Tushumlar', open: 'Tekshiruvdagi cheklar · 2',
      },
      nocard: {
        h: 'Toʻlov yopiq: toʻlov kartasi koʻrsatilmagan',
        facts: 'Xaridorlar «Toʻlov vaqtincha mavjud emas» deb koʻradi va buyurtma bera olmaydi.',
        open: 'Kartani koʻrsatish', note: 'Kartani faqat egasi koʻrsata oladi — unga xabar bering.',
      },
      clear: { h: 'Hammasi bajarildi', why: 'Yangi cheklar va buyurtmalar shu yerda oʻzi paydo boʻladi: sahifa har 30 soniyada yangilanadi.' },
    },
    queue: 'Ishda',
    rows: {
      receipts: ['Tekshiruvdagi cheklar', 'AI tasdiqlamadi — menejer hal qiladi'],
      accept: ['Qabul qilish', 'toʻlov tasdiqlangan'],
      assemble: ['Yigʻish', 'buyurtma qabul qilingan'],
      bts: ['BTSga topshirish', 'yigʻilmoqda'],
      credits: ['Buyurtmasiz tushumlar', 'pul tushgan, chek yoʻq'],
      refunds: ['Pulni qaytarish', 'toʻlangan va bekor qilingan'],
      stock: ['Ombor', 'tugagan · kam qolgan'],
      reviews: ['Sharhlar', 'nashrni kutmoqda'],
    },
    out: 'yoʻq', low: 'kam',
    age: {
      receipts: (m) => `${m} daqiqadan beri`, accept: 'eng eskisi — 41 daqiqa', assemble: '10:05 dan beri', bts: 'kecha 18:40 dan beri',
      credits: (L) => money(60000, L) + ', 09:49', stock: 'Blue Sapphire 30 ml va yana 4 ta', reviews: 'kecha 19:10 dan beri',
    },
    sys: { ok: 'Humo: 27 soniya oldin signal', bad: 'Humo: 34 daqiqadan beri signal yoʻq', backup: 'Zaxira nusxa: bugun 03:00', errors: 'Bir kunda xato yoʻq' },
    err: { b: 'Bosh sahifani yuklab boʻlmadi', p: 'Internetni tekshirib, qayta urinib koʻring.', retry: 'Qayta urinish' },
  },
};

/* The demo day. `tick` is one 30-second refresh in the mockup: a minute passes, one more paid order arrives. */
function day() {
  const k = S.tick;
  const base = { receipts: 1, accept: 3 + k, assemble: 2, bts: 4, credits: 1, refunds: 0, out: 3, low: 2, reviews: 2 };
  const d = { now: 'receipt', wait: 12 + k, q: base, humoBad: false };
  if (S.state === 'resolved') Object.assign(d, { now: 'accept', q: { ...base, receipts: 0, accept: 4 + k } });
  if (S.state === 'humo') Object.assign(d, { now: 'humo', humoBad: true, wait: 18 + k, q: { ...base, receipts: 2 } });
  if (S.state === 'nocard') { if (S.role === 'owner') d.now = 'nocard'; else d.banner = 'nocard'; }
  if (S.state === 'clear') Object.assign(d, { now: 'clear', q: { receipts: 0, accept: 0, assemble: 0, bts: 0, credits: 0, refunds: 0, out: 0, low: 0, reviews: 0 } });
  return d;
}

function side(t) {
  const groups = NAV.map(([g, items]) => {
    const vis = items.filter(([, , who]) => who === 'all' || S.role === 'owner');
    if (!vis.length) return '';
    return (g ? `<div class="grp">${t.groups[g]}</div>` : '') +
      vis.map(([k, ic]) => `<a href="#" class="it${k === 'home' ? ' on' : ''}"${k === 'home' ? ' aria-current="page"' : ''}>${I(ic)}${t.nav[k]}</a>`).join('');
  }).join('');
  const who = S.role === 'owner' ? ['AR', 'Aziz Rahimov'] : ['DK', 'Dilnoza Karimova'];
  return `<aside class="side"><div class="brand"><span class="logo">LUMMI.</span>${seg()}</div>
    <nav class="nav" aria-label="Разделы">${groups}</nav>
    <div class="me"><span class="ava">${who[0]}</span><span><div class="n">${who[1]}</div><div class="r">${t.roles[S.role]}</div></span><a class="out" href="#" aria-label="Выйти">${I('log-out')}</a></div></aside>`;
}
const seg = () => `<span class="seg"><span class="${S.lang === 'ru' ? 'on' : ''}">RU</span><span class="${S.lang === 'uz' ? 'on' : ''}">UZ</span></span>`;

function reports(t) {
  const figs = t.figs(S.lang).map(([k, v, d], i) =>
    `<div class="fig"><div class="k">${k}</div><div class="v tnum" data-k="f${i}">${v}</div><div class="d">${d}</div></div>`).join('');
  const max = Math.max(...DAYS);
  const bars = DAYS.map((v, i) => `<i class="${i === DAYS.length - 1 ? 'today' : ''}" style="height:${Math.round((v / max) * 100)}%"></i>`).join('');
  return `<section class="card rep" aria-labelledby="rep-h"><div class="rep-h"><h2 class="h3" id="rep-h">${t.sales} <span class="vs">${t.vs}</span></h2>
    <a class="more" href="#">${t.reports}${I('arrow-right')}</a></div>
    <div class="rep-b"><div class="figs">${figs}</div><div class="spark"><div class="bars" role="img" aria-label="${t.barsAria(S.lang)}">${bars}</div>
    <div class="bars-l"><span>${t.barsL[0]}</span><span>${t.barsL[1]}</span></div></div></div></section>`;
}

function nowBlock(t, d) {
  if (d.now === 'clear') {
    const c = t.now.clear;
    return `<section class="now calm" data-now="clear"><span class="disc">${I('check')}</span><div><h2>${c.h}</h2><p class="why">${c.why}</p></div></section>`;
  }
  const c = t.now[d.now];
  let thread = '';
  if (d.now === 'receipt') {
    const f = Math.min(d.wait / 15, 1);
    thread = `<div class="thread" role="img" aria-label="${c.wait(d.wait)}"><div class="track"><div class="fill" style="transform:scaleX(${f})"></div></div>
      <div class="ends tnum"><span data-k="wait">${c.wait(d.wait)}</span><span>${d.wait >= 15 ? c.sent : c.end}</span></div></div>`;
  }
  const left = `<div><h2>${c.h}</h2><p class="facts">${c.facts}</p>${c.why ? `<p class="why">${c.why}</p>` : ''}${thread}</div>`;
  let right;
  if (d.now === 'nocard') {
    right = S.role === 'owner' ? `<div class="acts"><a class="btn inv" href="#">${I('credit-card')}${c.open}</a></div>` : `<p class="note">${c.note}</p>`;
  } else {
    right = `<div class="acts"><a class="btn ghost" href="#">${c.all}</a><a class="btn inv" href="#">${c.open}${I('arrow-right')}</a></div>`;
  }
  return `<section class="now" data-now="${d.now}">${left}${right}</section>`;
}

/* The manager can't fix a missing card, so it is a line above the Now block, which keeps their own work. */
function banner(t) {
  const c = t.now.nocard;
  return `<div class="ban">${I('credit-card')}<p><b>${c.h}.</b> <span>${c.note}</span></p></div>`;
}

function queue(t, d) {
  const q = d.q, L = S.lang, A = t.age;
  const rows = [
    ['receipts', q.receipts, q.receipts ? A.receipts(d.wait) : '—'],
    ['accept', q.accept, q.accept ? A.accept : '—'],
    ['assemble', q.assemble, q.assemble ? A.assemble : '—'],
    ['bts', q.bts, q.bts ? A.bts : '—'],
    ['credits', q.credits, q.credits ? A.credits(L) : '—'],
    ['refunds', q.refunds, '—'],
    ['stock', q.out + q.low, q.out + q.low ? A.stock : '—'],
    ['reviews', q.reviews, q.reviews ? A.reviews : '—'],
  ];
  const lifted = { receipt: 'receipts', accept: 'accept', humo: 'receipts' }[d.now];
  const html = rows.map(([k, n, age]) => {
    const [label, sub] = t.rows[k];
    const count = k === 'stock' && n ? `${q.out}<small>${t.out}</small> ${q.low}<small>${t.low}</small>` : String(n);
    return `<a href="#" class="row${n ? '' : ' zero'}${k === lifted ? ' lift' : ''}"><span><div class="t">${label}</div><div class="s">${sub}</div></span>
      <span class="c tnum" data-k="q-${k}">${count}</span><span class="a" data-k="a-${k}">${age}</span><span class="chev">${I('chevron-right')}</span></a>`;
  }).join('');
  return `<section class="card" aria-labelledby="q-h"><div class="q-h"><h2 class="h3" id="q-h">${t.queue}</h2></div>${html}</section>`;
}

function sys(t, d) {
  return `<div class="sys"><span class="${d.humoBad ? 'bad' : ''}"><i class="dot"></i>${d.humoBad ? t.sys.bad : t.sys.ok}</span>
    <span><i class="dot"></i>${t.sys.backup}</span><span><i class="dot"></i>${t.sys.errors}</span></div>`;
}

function loading() {
  const bars = Array.from({ length: 8 }, () => `<div class="row"><span><div class="sk" style="height:14px;width:46%"></div><div class="sk" style="height:10px;width:30%;margin-top:8px"></div></span><span class="sk" style="height:18px;width:28px;justify-self:end"></span><span class="sk" style="height:10px;width:70%"></span><span></span></div>`).join('');
  return (S.role === 'owner' ? `<div class="card rep"><div class="sk" style="height:16px;width:140px"></div><div class="figs">${'<div><div class="sk" style="height:10px;width:60%"></div><div class="sk" style="height:22px;width:80%;margin-top:10px"></div></div>'.repeat(4)}</div></div>` : '') +
    `<div class="sk" style="height:176px;border-radius:12px"></div><div class="card"><div class="q-h"><div class="sk" style="height:14px;width:90px"></div></div>${bars}</div>`;
}

let prev = {}, prevNow = null, prevFill = null, first = true;
function render() {
  const t = T[S.lang], d = day();
  document.documentElement.lang = S.lang;
  let body;
  if (S.state === 'loading') body = loading();
  else if (S.state === 'error') body = `<div class="err"><span><b>${t.err.b}</b><p>${t.err.p}</p></span><a class="btn pri" href="#">${I('refresh-cw')}${t.err.retry}</a></div>`;
  else body = (S.role === 'owner' ? reports(t) : '') + (d.banner ? banner(t) : '') + nowBlock(t, d) + queue(t, d) + (S.role === 'owner' ? sys(t, d) : '');
  const sub = S.state === 'loading' || S.state === 'error' ? t.subBare : t.sub(S.tick);
  const app = document.getElementById('app');
  app.classList.toggle('phone', S.view === 'phone');
  app.innerHTML = `<div class="topbar"><span class="logo">LUMMI.</span><span class="r">${seg()}${I('menu')}</span></div>
    <div class="shell">${side(t)}<main><div class="page"><h1 class="title">${t.title}</h1><p class="sub">${sub}</p><div class="stack">${body}</div></div></main></div>`;
  /* Motion: only what changed moves. A value that changed on refresh settles out of a 2 px blur;
     a new item in the Now block arrives (opacity + blur + 6 px). Nothing animates on first load. */
  const now = app.querySelector('[data-now]');
  if (!first && now && now.dataset.now !== prevNow) {
    now.classList.add('arrive');
    /* One stable live region, outside the re-rendered tree: it speaks only when the Now item changes. */
    document.getElementById('live').textContent = now.querySelector('h2').textContent;
  }
  /* The Thread grows from where it was (production keeps the node; the mockup replays it). */
  const fill = app.querySelector('.fill');
  const f = d.now === 'receipt' && S.state !== 'loading' && S.state !== 'error' ? Math.min(d.wait / 15, 1) : null;
  if (!first && fill && prevFill !== null && f !== prevFill) {
    fill.style.transition = 'none';
    fill.style.transform = `scaleX(${prevFill})`;
    fill.getBoundingClientRect();
    fill.style.transition = '';
    fill.style.transform = `scaleX(${f})`;
  }
  prevFill = f;
  app.querySelectorAll('[data-k]').forEach((el) => {
    if (!first && prev[el.dataset.k] !== undefined && prev[el.dataset.k] !== el.innerHTML) el.classList.add('changed');
  });
  prev = {};
  app.querySelectorAll('[data-k]').forEach((el) => (prev[el.dataset.k] = el.innerHTML));
  prevNow = now ? now.dataset.now : null;
  first = false;
}

const sel = (id, key) => {
  const el = document.getElementById(id);
  el.value = S[key];
  el.addEventListener('change', () => {
    S[key] = el.value;
    if (key !== 'view') S.tick = 0;
    const u = new URL(location.href);
    u.searchParams.set(key, el.value);
    history.replaceState(null, '', u);
    if (key === 'lang' || key === 'role' || key === 'view') first = true;
    render();
  });
};
sel('m-role', 'role'); sel('m-lang', 'lang'); sel('m-state', 'state'); sel('m-view', 'view');
document.getElementById('m-refresh').addEventListener('click', () => { S.tick += 1; render(); });
render();
