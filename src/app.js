const express = require('express');
const bodyparser = require('body-parser');
const cors = require("cors");
const app = express();

require('dotenv').config();
const corsOptions = {
    origin: ['*'],
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
};

app.use(cors(corsOptions));


// ******************Gestor********************************************* 
const loginRoute = require('./routes/login');
const condominioRoute = require('./routes/condominio');
// ******************Gestor fim********************************************* 


const auth = require('./helpers/auth');

app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: false }));

app.get('/api/health', (req, res) => {
    return res.status(200).json({ status: 'ok', service: 'backend-condominio' });
});

app.use('/api/login', loginRoute);
app.use('/api/condominio', condominioRoute);

app.use('/login', loginRoute);

app.use('/uploads', express.static(__dirname + '/uploads'))
app.use('/tmp', express.static(__dirname + '/tmp'))
app.use('/uploadsbanners', express.static(__dirname + '/uploads/banners'))

app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({ error: error.message })
});


module.exports = app;