const express = require('express');
const bodyparser = require('body-parser');
const cors = require("cors");
const path = require('path');
const app = express();

require('dotenv').config();

// Segredos obrigatórios (JWT_SECRET, SERVICE_INVITE_TOKEN_SECRET): sem eles o
// processo não sobe. Não existe mais fallback fixo no código.
require('./helpers/segredos').validarSegredosNaInicializacao();

// Na Vercel há exatamente um proxy na frente: req.ip passa a ser o IP real do
// cliente (primeiro salto do X-Forwarded-For gravado pelo proxy), e não um
// valor arbitrário enviado pelo navegador.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Headers de segurança. A API só devolve JSON e arquivos, então a CSP pode ser
// a mais restritiva possível (impede execução de HTML/SVG servido por engano).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

// CORS: antes era origin: ['*'] (array com o texto "*"), que o pacote cors
// nunca casa — na prática nenhum navegador recebia Access-Control-Allow-Origin.
// Mantido o mesmo comportamento por padrão; origens explícitas via env
// CORS_ORIGINS (separadas por vírgula).
const corsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
const corsOptions = {
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
};

app.use(cors(corsOptions));

// Em produção, respostas 5xx não expõem detalhes internos (mensagens de erro
// SQL, stack, nomes de tabela). O detalhe vai para o log do servidor.
const ocultarDetalhesDeErro = String(process.env.EXPOR_DETALHE_ERRO || '').toLowerCase() !== 'true';
app.use((req, res, next) => {
    const jsonOriginal = res.json.bind(res);
    res.json = (corpo) => {
        if (ocultarDetalhesDeErro && res.statusCode >= 500 && corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
            if (corpo.detail !== undefined || corpo.stack !== undefined) {
                console.error(`[erro ${res.statusCode}] ${req.method} ${req.originalUrl.split('?')[0]}:`, corpo.detail || corpo.stack);
                const { detail, stack, ...seguro } = corpo;
                return jsonOriginal(seguro);
            }
        }
        return jsonOriginal(corpo);
    };
    next();
});


// ******************Gestor*********************************************
const loginRoute = require('./routes/login');
const condominioRoute = require('./routes/condominio');
const usuarioRoute = require('./routes/usuario');
const recoveryRoute = require('./routes/recovery');
const reuniaoRoute = require('./routes/reuniao');
const financeiroRoute = require('./routes/financeiro');
const manutencaoRoute = require('./routes/manutencao');
const whatsappRoute = require('./routes/whatsapp');
const integracaoBancariaRoute = require('./routes/integracaoBancaria');
const webhookBancarioRoute = require('./routes/webhookBancario');
// ******************Gestor fim*********************************************

app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: false }));

app.get('/api/health', (req, res) => {
    return res.status(200).json({ status: 'ok', service: 'backend-condominio' });
});

app.use('/api/login', loginRoute);
app.use('/api/condominio', condominioRoute);
app.use('/api/usuario', usuarioRoute);
app.use('/api/auth/recovery', recoveryRoute);
app.use('/api/reuniao', reuniaoRoute);
app.use('/api/condominio/financeiro', financeiroRoute);
app.use('/api/condominio/manutencao', manutencaoRoute);
app.use('/api/whatsapp', whatsappRoute);
app.use('/api/condominio/financeiro/integracao-bancaria', integracaoBancariaRoute);
app.use('/api/webhook/bancario', webhookBancarioRoute);

app.use('/login', loginRoute);
app.use('/service/back-cond.php', loginRoute);
app.use('/service', condominioRoute);

// Pastas estáticas legadas (logos usados em templates de e-mail). Só imagens
// são servidas — antes qualquer arquivo era público (ex.: um .js de swagger em
// uploads/transaction/).
const EXTENSOES_ESTATICAS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const estaticoSomenteImagens = (pasta) => {
    const servir = express.static(pasta, { dotfiles: 'deny', index: false, redirect: false });
    return (req, res, next) => {
        const extensao = path.extname(String(req.path || '')).toLowerCase();
        if (!EXTENSOES_ESTATICAS.has(extensao)) {
            return res.status(404).json({ message: 'Não encontrado.' });
        }
        return servir(req, res, next);
    };
};
app.use('/uploads', estaticoSomenteImagens(path.join(__dirname, 'uploads')));
app.use('/tmp', estaticoSomenteImagens(path.join(__dirname, 'tmp')));
app.use('/uploadsbanners', estaticoSomenteImagens(path.join(__dirname, 'uploads', 'banners')));

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    // Erros de upload (multer) e de corpo inválido têm status próprios.
    if (error && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Arquivo excede o tamanho máximo permitido.' });
    }
    if (error && typeof error.code === 'string' && error.code.startsWith('LIMIT_')) {
        return res.status(400).json({ error: 'Upload inválido.' });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) {
        console.error(`[erro ${status}] ${req.method} ${req.originalUrl.split('?')[0]}:`, error?.stack || error?.message);
        return res.status(status).json({ error: 'Erro interno.' });
    }
    return res.status(status).json({ error: error.expose ? error.message : 'Requisição inválida.' });
});


module.exports = app;
