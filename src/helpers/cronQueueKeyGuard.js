const crypto = require('crypto');
const { consumir } = require('./rateLimit');
const { ipEfetivo, ipObservado } = require('./ipCliente');

// Guarda das rotas disparadas por cron externo (fila de mensagens,
// receitas/rotinas, reconciliação bancária): header X-Cron-Queue-Key
// comparado em tempo constante com CRON_QUEUE_KEY. Sem JWT — quem chama é o
// agendador. Fail closed: sem CRON_QUEUE_KEY no servidor, tudo é 401.
//
// Tentativas inválidas contam no rate limit persistente (tb_rate_limit) por
// IP: acima do limite, 429. O caminho da chave válida não consulta o banco.
// O valor da chave nunca é logado.
const LIMITE_INVALIDAS = 20;
const JANELA_SEG = 900;

function _chaveValida(expectedKey, providedKey) {
	if (!expectedKey || !providedKey) return false;
	const expectedBuffer = Buffer.from(String(expectedKey));
	const providedBuffer = Buffer.from(String(providedKey));
	return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = async (req, res, next) => {
	const expectedKey = process.env.CRON_QUEUE_KEY;
	const providedKey = req.header('X-Cron-Queue-Key');

	if (_chaveValida(expectedKey, providedKey)) {
		return next();
	}

	const ip = ipEfetivo(req).ip || ipObservado(req) || 'ip-desconhecido';
	const rota = String(req.originalUrl || '').split('?')[0];
	console.warn(`[cronQueueKeyGuard] chave ${providedKey ? 'inválida' : 'ausente'} rota=${rota}${expectedKey ? '' : ' (CRON_QUEUE_KEY não configurada)'}`);

	try {
		const consumo = await consumir(`cron:auth:ip:${ip}`, LIMITE_INVALIDAS, JANELA_SEG);
		if (!consumo.permitido) {
			res.set('Retry-After', String(JANELA_SEG));
			return res.status(429).json({ message: 'Muitas tentativas. Tente mais tarde.' });
		}
	} catch (_) {
		// Rate limit indisponível: continua negando (401).
	}
	return res.status(401).json({ message: 'Não autorizado.' });
};

module.exports.LIMITE_INVALIDAS = LIMITE_INVALIDAS;
