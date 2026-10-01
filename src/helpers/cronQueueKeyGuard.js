const crypto = require('crypto');

// Guarda das rotas disparadas por cron externo (fila de mensagens,
// reconciliação bancária): header X-Cron-Queue-Key comparado em tempo
// constante com CRON_QUEUE_KEY. Sem JWT — quem chama é o agendador.
module.exports = (req, res, next) => {
	const expectedKey = process.env.CRON_QUEUE_KEY;
	const providedKey = req.header('X-Cron-Queue-Key') || req.header('x-cron-queue-key');

	if (!expectedKey || !providedKey) {
		return res.status(401).json({ message: 'Não autorizado.' });
	}

	const expectedBuffer = Buffer.from(String(expectedKey));
	const providedBuffer = Buffer.from(String(providedKey));

	if (
		expectedBuffer.length !== providedBuffer.length ||
		!crypto.timingSafeEqual(expectedBuffer, providedBuffer)
	) {
		return res.status(401).json({ message: 'Não autorizado.' });
	}

	return next();
};
