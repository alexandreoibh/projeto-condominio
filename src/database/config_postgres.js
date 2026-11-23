require('dotenv').config();

// SSL é SEMPRE ligado e o certificado do servidor é verificado.
// - DB_SSL_CA: PEM do CA (para certificado autoassinado/CA própria). Aceita PEM
//   direto, PEM com "\n" escapado (formato comum em env da Vercel) ou base64.
// - DB_SSL_SERVERNAME: nome do certificado, quando difere do host de conexão.
// - DB_SSL_REJECT_UNAUTHORIZED=false: saída de emergência que desliga a
//   verificação do certificado (o tráfego continua cifrado). Evite em produção.
const _lerCaSsl = (valor) => {
    const texto = String(valor || '').trim();
    if (!texto) return undefined;
    if (texto.includes('-----BEGIN')) {
        return texto.replace(/\\n/g, '\n');
    }
    const decodificado = Buffer.from(texto, 'base64').toString('utf8');
    if (decodificado.includes('-----BEGIN')) {
        return decodificado;
    }
    throw new Error('DB_SSL_CA inválido: informe o certificado PEM (texto ou base64).');
};

const _montarSsl = () => {
    const verificar = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() !== 'false';
    if (!verificar) {
        console.warn('[db] verificação do certificado TLS DESATIVADA (DB_SSL_REJECT_UNAUTHORIZED=false).');
    }

    const ssl = {
        require: true,
        rejectUnauthorized: verificar
    };

    const ca = _lerCaSsl(process.env.DB_SSL_CA);
    if (ca) ssl.ca = ca;

    const servername = String(process.env.DB_SSL_SERVERNAME || '').trim();
    if (servername) ssl.servername = servername;

    return ssl;
};

module.exports = {
    dialect: 'postgres',
    dialectModule: require('pg'),
    host: process.env.DB_HOST_SQL_POSTGRE,
    port: process.env.PORTA_SQL_POSTGRE,
    username: process.env.USER_SQL_POSTGRE,
    password: process.env.PASSWORD_SQL_POSTGRE,
    database: process.env.DATABASE_POSTGRE,
    dialectOptions: {
        ssl: _montarSsl()
    },
    define: {
        timestamp: true,
        underscored: true,
    },
}
