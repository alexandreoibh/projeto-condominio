

module.exports = {
    user: process.env.USER_SQL,
    password:process.env.PASSWORD_SQL,
    server: process.env.DB_HOST_SQL,
    port: Number(process.env.PORTA_SQL),
    database: process.env.DATABASE,
    requestTimeout: 200000,
    options: {
      enableArithAbort: true,
      encrypt: false,
      useUTC: false,
    },
};
// module.exports = {
//     user: "user_front",
//     password: "pVmhErgX3jrQ4ELPO%Ya",
//     server: '104.41.37.209',
//     port: Number(25622),
//     database: process.env.DATABASE,
//     requestTimeout: 200000,
//     options: {
//       enableArithAbort: true,
//       encrypt: false,
//       useUTC: false,
//     },
//   };