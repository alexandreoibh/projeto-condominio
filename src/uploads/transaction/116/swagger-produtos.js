const axios = require("axios");
require("dotenv").config();

const urlBase = `${process.env.SWAGGER_WEB_URL}`;
const SWAGGER_USER = process.env.SWAGGER_USER;
const SWAGGER_PASSWORD = process.env.SWAGGER_PASSWORD;
const API = {};

API.get = async ( data) => {
  try {
    
    const retorno = await axios({
      url: `${urlBase}/v1/qtlink`,
      method: 'get',
      headers: {
        'Accept-Encoding': 'application/gzip'
      },
      auth: {
        username: SWAGGER_USER,
        password: SWAGGER_PASSWORD,
      },
      data: data,
    })
   return retorno;

  } catch (error) {
    return error;
  }
};

module.exports = API;
