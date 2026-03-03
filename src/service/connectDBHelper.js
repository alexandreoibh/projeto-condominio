const sql = require('mssql');

const databaseConfig = require('./config');

class ConnectDBHelper {
    constructor() {
        throw new Error('Essa classe não pode ser instanciada');
    }

    static async connect() {
        return await new sql.ConnectionPool(databaseConfig).connect();
    }

    static _preencherParametros(req, params) {
        params.forEach((item, index) => {
            req.input(index, sql[item.tipo], item.value);
        });
        return req;
    }

    static async executeQuery(query, params = []) {
        try {
            if (!this.con) {
                this.con = await this.connect();
            }

            let req = this.con.request();
            req = this._preencherParametros(req, params);

            return await req.query(query);
        } catch (err) {
            console.log('----------------------------------------------------');
            console.log(err);
            console.log('----------------------------------------------------');
            console.log(query);
            // ... error checks
            return false;
        }
    }

    static async executeQueryAsync(query, res = null, params = []) {
        try {
            if (!this.con) {
                this.con = await this.connect();
            }

            let req = this.con.request();
            // add params
            req = this._preencherParametros(req, params);
            let response = req.query(query);

            return response;
        } catch (err) {
            console.log(err);
            if (res) {
                res.status(500).json(err);
            }
        }
    }

    static async request() {
        if (!this.con) {
            this.con = await this.connect();
            console.log('\x1b[32m', 'Nova conexao');
        }
        return this.con.request();
    }

}

module.exports = function() {
    return ConnectDBHelper;
};
