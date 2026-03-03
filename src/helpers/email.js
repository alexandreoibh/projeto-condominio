"user strict";
const mailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const fs = require("fs");
const { resolve } = require("path");
const { Resend } = require("resend");
var postmark = require("postmark");
const nodemailer = require('nodemailer');


class Email {


  static async enviarEmailSendgrid(req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template) {
    try {

      console.log(process.env.BASE_URL, 'email.......................', email);
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.BASE_URL}/uploads/security.jpg">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
            </table>
            `;

      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure:true,
        auth: {
          user: 'alexandreoibh1@gmail.com',
          pass: 'owzc tqxn shgf ecnu',
        },
      });
      transporter.verify().then(console.log).catch(console.error);

      const msg = {
        to: [email], // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Zbrothers-Security<nao-responda@naoresponda.com>",
        subject: assunto,
        html: message,
        // attachments: [
        //   {
        //     content: attachment,
        //     filename: arquivo,
        //     type: "application/pdf",
        //     disposition: "attachment",
        //   },
        // ],
      };

      transporter.sendMail(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error, 'Errorr-----------  ----');
        });






    } catch (err) {
      console.log('err', err);
      res.status(500).send(err);
    }
  }
  static async enviarEmailResend(req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template) {
    try {

      console.log(process.env.BASE_URL, 'email.......................', email);
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.BASE_URL}/uploads/security.jpg">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
            </table>
            `;

      const instanceResend = new Resend('re_orLm3H2c_736pzsXm7TEuxPmCmp99nzoK');

      const msg = {
        to: email, // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        bcc: 'alexandreoibh@hotmail.com',
        cc: 'alexandreoibh@hotmail.com',
        from: "Zbrothers-Security<onboarding@resend.dev>", // Change to your verified sender
        subject: assunto,
        html: message,
        // attachments: [
        //   {
        //     content: attachment,
        //     filename: arquivo,
        //     type: "application/pdf",
        //     disposition: "attachment",
        //   },
        // ],
      };

      instanceResend.emails.send(msg).then((response) => {
        console.log(response, "Email enviado");
        return response;
      }).catch((error) => {
        console.error(error);
      });;


      console.log('result email', instanceResend);



    } catch (err) {
      console.log('err', err);
      res.status(500).send(err);
    }
  }
  static async enviarEmailPostMarkaap(req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template) {
    try {

      console.log(process.env.BASE_URL, 'email.......................', email);
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.BASE_URL}/uploads/security.jpg">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
            </table>
            `;


      let client = new postmark.ServerClient(process.env.POSTMARKAP_API_KEY);

      const msg = {
        to: email, // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        // bcc: 'alexandreoibh@hotmail.com',
        // cc: 'alexandreoibh@hotmail.com',
        From: "Zbrothers-Security<thiago@zbrothersconstruction.com>", // Change to your verified sender
        subject: assunto,
        TextBody: message,
        // attachments: [
        //   {
        //     content: attachment,
        //     filename: arquivo,
        //     type: "application/pdf",
        //     disposition: "attachment",
        //   },
        // ],
      };

      // client.sendEmail({
      //   "From": "sender@example.com",
      //   "To": "recipient@example.com",
      //   "Subject": "Test",
      //   "TextBody": "Hello from Postmark!"
      // });

      client.sendEmail(msg).then((response) => {
        console.log(response, "Email enviado");
        return response;
      }).catch((error) => {
        console.error(error);
      });;


      console.log('result email', client);



    } catch (err) {
      console.log('err', err);
      res.status(500).send(err);
    }
  }

  static async enviarEmail(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.APP_URL}/uploads/logo-philos_cor.png">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      if (template == 2) {
        templateImage = `
                <table style="width: 800px">
                    <tr>
                        <td>
                            <img style="width: 800px" src="${process.env.APP_URL}/uploads/logo-philos_cor_email2.fw.png">
                        </td>
                    </tr>
                </table>`;
      }

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
            </table>
            `;

      //   const smtpTransport = mailer.createTransport({
      //     host: "smtp.umbler.com",
      //     port: 587,
      //     secure: false, //SSL/TLS
      //     auth: {
      //       user: "contato@linharesseguros.com.br",
      //       pass: "#Edalsc08",
      //     },
      //   });

      //   const mail = {
      //     from: "Cleyton Silva <contato@linharesseguros.com.br>",
      //     to: email,
      //     subject: assunto,
      //     html: message,
      //   };

      //   if (anexo) {
      //     console.log(anexo);
      //     mail.attachments = [];
      //     mail.attachments.push({
      //       filename: anexo.originalname,
      //       content: anexo.buffer,
      //     });
      //   }
      //   return new Promise((resolve, reject) => {
      //     smtpTransport
      //       .sendMail(mail)
      //       .then((response) => {
      //         smtpTransport.close();
      //         return resolve(response);
      //       })
      //       .catch((error) => {
      //         smtpTransport.close();
      //         return reject(error);
      //       });
      //   });
      //https://cadastro.xpi.com.br/?assessor=A65946
      let attachment = '';
      let arquivo = 'PhilosInvest.pdf';
      if (anexo == true) {
        let pathToAttachment = `${path}/${arquivo}`;
        attachment = fs.readFileSync(pathToAttachment).toString("base64");
      }

      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const msg = {
        to: [email], // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Philos Investimentos<meumundo@philosinvest.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
        attachments: [
          {
            content: attachment,
            filename: arquivo,
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      };

      sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error);
        });


    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }

  async enviarEmailMovimentacoes(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    dados,
    nomeGestorEnviar,
    type,
    emailSend
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = '';
      let meuEmail = req.emailUsuario;
      email[1] = meuEmail;

      // let templateImage = `
      //       <table style="border:1px solid #BFCFFF; width: 800px">
      //           <tr>
      //               <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 20px">
      //                   <img style="width: 20px !important" src="${process.env.APP_URL}/uploads/logo-philos_cor.png">
      //               </td>
      //           </tr>
      //       </table>`;
      // ${ item.NomeBanco }
      templateImage += `<!DOCTYPE html>
                    <html>
                    <head>
                    <style>
                        .cor1 {
                          color:green !important;
                          font-weight: bold !important;
                        }
                        .cor2 {
                          color:red !important;
                          font-weight: bold !important;
                        }
                        .cor3 {
                          color:warning !important;
                          font-weight: bold !important;
                        }

                        table {
                          border-collapse: collapse;
                          width: 100%;
                          border-bottom: 1px solid #ddd;
                          color:red !importante;
                        }

                        th, {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-weight: bold;
                          font-size: 1rem !important;
                          border-bottom: .5px solid #04314B;
                        }

                        th, td {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-size: 0.7rem !important;
                          border-bottom: .5px solid #04314B;
                          font-family: 'Montserrat', sans-serif;
                        }
                        b {
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        p{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        body{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        h4{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                    </style>
                    </head>
                    <body>
                    
                    `
      // <i> (Validação : emails da gestora que serão enviados ${emailSend.length >= 1 ? emailSend[0].Email : 'Não encontrado email em contatos'} ${emailSend.length >= 2 ? emailSend[1].Email : ''} ${emailSend.length >= 3 ? emailSend[2].Email : ''} )</i>              

      let cont = 1;
      await dados.map(function (item, i) {
        // console.log(nomeGestorEnviar,'AAQQIIIIIIIII', item);
        if (item.NomeGestor == nomeGestorEnviar) {
          let check = "BNY MELLON SERVIÇOS FINANCEIROS DTVM";
          // console.log(item.infogestora, 'AAQQIIIIIIIII AdminNomeAdministrador',check.indexOf(item.AdminNomeAdministrador.substr(0, 10)));
          // console.log(item.infogestora,'Foraaaaaaaaaaaaaaa', item.AdminNomeAdministrador.substr(0, 10));
          // if (check.indexOf(item.AdminNomeAdministrador.substr(0, 10)) != -1) {
          if (item.infogestora == 9 && cont == 1) {
            // console.log(cont,'Entrouuuuuuuuuuuuuuuuuu', item.AdminNomeAdministrador.substr(0, 10));
            templateImage +=
              `</br></br>Prezados,</br></br>
               Seguem as movimentações boletadas no SMA na data de hoje.</br>
               Poderiam conferir, por favor?</br>`;
            cont++;
          }
        }
      });



      templateImage +=
        `<h4> Movimentação da Gestora : <b>${nomeGestorEnviar}</b></h4>
                    <table>
                      <tr>
                        <th>Nome Cliente</th>
                        <th>Cpf Cliente</th>
                        <th>CoTitular</th>
                        <th>Cpf CoTitular</th>
                        <th>Nome Fundo</th>
                        <th>Tipo Movimentação</th>
                        <th>Valor Movimentação</th>
                        <th>Banco</th>
                        <th>Agência</th>
                        <th>Conta</th>
                        <th>Data Pedido</th>
                        <th>Data Cotização</th>
                        <th>Data Liquidação</th>
                        <th>Contato Telefônico</th>
                        <th>Observação</th>
                      </tr><tbody> `;
      await dados.map(function (item, i) {
        if (item.NomeGestor == nomeGestorEnviar) {
          templateImage += `<tr>
                                <td> ${item.NomeCliente} </td>
                                <td> ${item.CpfCliente ? item.CpfCliente : '-'} </td>
                                <td> ${item.NomeCoTitular ? item.NomeCoTitular : '-'} </td>
                                <td> ${item.CpfCotutular ? item.CpfCotutular : '-'} </td>
                                <td> ${item.NomeFundo} </td>
                                <td class='cor${item.IdTipoMovimentacao}'> ${item.NomeTipoMovimentacao} </td>
                                <td> ${item.ValorMovimentacao.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })} </td>
                                <td> ${item.NomeBanco ? item.NomeBanco : '-'} </td>
                                <td> ${item.Agencia ? item.Agencia : '-'} </td>
                                <td> ${item.Conta ? item.Conta : '-'} </td>
                                <td> ${item.DataPedido} </td>
                                <td> ${item.DataCotizacao} </td>
                                <td> ${item.DataLiquidacao} </td>
                                <td> ${item.ContatoTelefonico} </td>
                                <td> ${item.ObservacaoGestor} </td>
                            </tr>`;
        }
      });

      templateImage += `</tbody></table>
                    <br>
                    <p><b>Favor confirmar o recebimento e as informações contidas nesse e-mail ! Muito Obrigado. </b></p>
                    <br><br>
                    Atenciosamente,<br>
                    Movimentações  - Philos Investimentos <br>
                    Tel: (21) 2512-2766<br>
                    Av. Ataulfo de Paiva, 1120 /  Sala 501 <br>
                    Leblon - Rio de Janeiro - RJ 22440-035<br>
                    <a href="https://www.philosinvest.com.br">https://www.philosinvest.com.br</a>

                    <br> <br> <br>
                    <table border="1" style="width:80%">
                      <tr>
                        <td>
                          <h3>Philos Invest - Sua Assessoria de investimentos no mercado financeiro.</h3>
                          <br>  
                          Sua Assessoria de investimentos no mercado financeiro. Seus dados não serão utilizados para envio de qualquer tipo de SPAM. 
                          Ao prosseguir, você declara ter lido e estar ciente das condições de tratamento dos seus dados e do seu consentimento conforme descrito em nossa política de privacidade.
                       </td>
                      </tr>
                    </table>  
                    </body>
                    </html> `;
      let message = `${templateImage}`;

      sgMail.setApiKey(process.env.SENDGRID_API_KEY_MOV);

      let emailTo = [];
      emailSend.length >= 1 ? emailTo.push(emailSend[0].Email.toLowerCase()) : "";
      emailSend.length >= 2 ? emailTo.push(emailSend[1].Email.toLowerCase()) : "";
      emailSend.length >= 3 ? emailTo.push(emailSend[2].Email.toLowerCase()) : "";

      const arrEmailUnique = [...new Set(emailTo)]
      // console.log(arrEmailUnique, '.............................lista .............................');
      // console.log(assunto, '.....assuntoassuntoassuntoassuntoassuntoassuntoassunto.....');
      const msg = {
        // to: ['alexandreoibh1@gmail.com'], // Change to your recipient
        to: arrEmailUnique, // Change to your recipient
        cc: ['movimentacao@philosinvestimentos.com.br'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Movimentacao - Philos Investimentos<movimentacao@philosinvestimentos.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
      };

      return await sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;
        })
        .catch((error) => {
          console.error(error, error.code, error.response.body.errors);
          return error.code;
        });


    } catch (err) {
      // res.status(500).send(err);
      return err;
    }
  }

  static async enviarEmailMovimentacoesCancelamento(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    dados,
    nomeGestorEnviar,
    type,
    envioClienteEm,
    emailSend
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = '';
      let meuEmail = req.emailUsuario;
      email[1] = meuEmail;

      templateImage += `<!DOCTYPE html>
                    <html>
                    <head>
                    <style>
                        .cor1 {
                          color:green !important;
                          font-weight: bold !important;
                        }
                        .cor2 {
                          color:red !important;
                          font-weight: bold !important;
                        }
                        .cor3 {
                          color:warning !important;
                          font-weight: bold !important;
                        }
                        .titItme {
                          text-align: center !important;
                        }

                        table {
                          border-collapse: collapse;
                          width: 40%;
                          border-bottom: 1px solid #ddd;
                          color:red !importante;
                        }

                        th, {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-weight: bold;
                          font-size: 1rem !important;
                          border: .5px solid #04314B;
                        }

                        th, td {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-size: 0.7rem !important;
                          border: .5px solid #04314B;
                          font-family: 'Montserrat', sans-serif;
                        }
                        b {
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        p{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        body{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        h4{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                    </style>
                    </head>
                    <body>
                    
                    `;

      let emailTo = [];
      if (envioClienteEm == 1) {
        // <i> (Validação : enviado para o email do cliente ${emailSend[0].EMail01} ${emailSend[0].EMail02 ? emailSend[0].EMail02 : ''}   )</i>
        templateImage += `  <h4> Solicitado o cancelamento da movimentação abaixo da Gestora : <b>${nomeGestorEnviar}</b></h4>
                            <br> `;
        emailSend[0].EMail01 ? emailTo.push(emailSend[0].EMail01) : "";
        emailSend[0].EMail02 ? emailTo.push(emailSend[0].EMail02) : "";

      } else {
        // <i> (Validação : emails da gestora que serão enviados  ${emailSend[0] ? emailSend[0].Email : "Não encontrado email em contatos"}  )</i>
        templateImage += ` 
                    <h4> Favor CANCELAR a movimentação abaixo da Gestora : <b>${nomeGestorEnviar}</b></h4>
                    <br> `;
        emailSend[0] ? emailTo.push(emailSend[0].Email) : "";
      }

      templateImage += ``;
      let itemEmail = 1;
      dados.forEach(function (item, index) {
        if (item.NomeGestor == nomeGestorEnviar) {
          templateImage += `
                      <table>
                        <tbody>
                          <tr>
                              <th colspan="2" class="titItme"> MOVIMENTAÇÃO ${itemEmail} </th>
                          </tr>
                          <tr>
                            <th>Nome Cliente</th>
                            <td> ${item.NomeCliente}  </td>
                          </tr>
                          <tr>
                            <th>CoTitular</th>
                            <td> ${item.NomeCoTitular ? item.NomeCoTitular : '-'}   </td>
                          </tr>
                          <tr>
                            <th>Nome Fundo</th>
                            <td> ${item.NomeFundo} </td>
                          </tr>
                          <tr>
                            <th>Tipo Movimentação/th>
                            <td class='cor${item.IdTipoMovimentacao}'> ${item.NomeTipoMovimentacao} </td>
                          </tr>
                          <tr>
                            <th>Valor Movimentação</th>
                            <td> ${item.ValorMovimentacao.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })} </td>
                          </tr>
                          <tr>
                            <th>Nome Banco</th>
                            <td> ${item.NomeBanco ? item.NomeBanco : '-'} </td>
                          </tr>
                          <tr>
                            <th>Agência</th>
                            <td> ${item.Agencia ? item.Agencia : '-'} </td>
                          </tr>
                          <tr>
                            <th>Conta</th>
                            <td> ${item.Conta ? item.Conta : '-'} </td>
                          </tr>
                          <tr>
                            <th>Data Pedido</th>
                            <td> ${item.DataPedido} </td>
                          </tr>
                          <tr>
                            <th>Data Cotização</th>
                            <td> ${item.DataCotizacao} </td>
                          </tr>
                          <tr>
                            <th>Data Liquidação</th>
                            <td> ${item.DataLiquidacao} </td>
                          </tr>
                          <tr>
                            <th>Contato Telefônico</th>
                            <td> ${item.ContatoTelefonico} </td>
                          </tr>
                          <tr>
                            <th>Observação</th>
                            <td> ${item.ObservacaoGestor} </td>
                          </tr> 
                        </tbody>
                      </table>  
                      <br><br>
                   `;
          itemEmail++;
        }
      });

      templateImage += `
                    <br>
                    <p><b>Favor confirmar o recebimento e as informações contidas nesse e-mail ! Muito Obrigado. </b></p>
                    <br><br>
                    Atenciosamente,<br>
                    Movimentações  - Philos Investimentos <br>
                    Tel: (21) 2512-2766<br>
                    Av. Ataulfo de Paiva, 1120 /  Sala 501 <br>
                    Leblon - Rio de Janeiro - RJ 22440-035<br>
                    <a href="https://www.philosinvest.com.br">https://www.philosinvest.com.br</a>

                    <br><br> <br>
                    <table border="1" style="width:80%">
                      <tr>
                        <td>
                          <h3>Philos Invest - Sua Assessoria de investimentos no mercado financeiro.</h3>
                          <br>  
                          Sua Assessoria de investimentos no mercado financeiro. Seus dados não serão utilizados para envio de qualquer tipo de SPAM. 
                          Ao prosseguir, você declara ter lido e estar ciente das condições de tratamento dos seus dados e do seu consentimento conforme descrito em nossa política de privacidade.
                       </td>
                      </tr>
                    </table>  
                    </body>
                    </html> `;
      let message = `${templateImage}`;

      const arrEmailUnique = [...new Set(emailTo)]
      console.log(arrEmailUnique, '.....lista.....', emailTo);

      sgMail.setApiKey(process.env.SENDGRID_API_KEY_MOV);
      const msg = {
        // to: ['alexandreoibh1@gmail.com'], // Change to your recipient
        to: arrEmailUnique, // Change to your recipient
        cc: ['movimentacao@philosinvestimentos.com.br'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Movimentacao - Philos Investimentos<movimentacao@philosinvestimentos.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
      };

      sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error);
        });


    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }

  async enviarEmailMovimentacoesCliente(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    dados,
    nomeGestorEnviar,
    type,
    emailSend
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = '';
      let meuEmail = req.emailUsuario;
      // email[1] = meuEmail;
      // console.log('AAAAAAAAQQQQQQQQQ', email);

      templateImage += `<!DOCTYPE html>
                    <html>
                    <head>
                    <style>
                        .cor1 {
                          color:green !important;
                          font-weight: bold !important;
                        }
                        .cor2 {
                          color:red !important;
                          font-weight: bold !important;
                        }
                        .cor3 {
                          color:warning !important;
                          font-weight: bold !important;
                        }
                        .titItme {
                          text-align: center !important;
                        }
                        
                        table {
                          border-collapse: collapse;
                          width: 40%;
                          border-bottom: 1px solid #ddd;
                          color:red !importante;
                        }

                        th, {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-weight: bold;
                          font-size: 1rem !important;
                          border: .5px solid #04314B;
                        }

                        th, td {
                          text-align: left;
                          padding: 8px;
                          color:#04314B;
                          font-size: 0.7rem !important;
                          border: .5px solid #04314B;
                          font-family: 'Montserrat', sans-serif;
                        }
                        b {
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        p{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        body{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                        h4{
                          color:#04314B;
                          font-family: 'Montserrat', sans-serif;
                        }

                    </style>
                    </head>
                    <body>
                    
                    <h4> Prezado, <br> Ordem solicitada : </h4>
                    <br>
                    `;
      // <i> (Validação : enviado para o email do cliente ${emailSend[0].EMail01} ${emailSend[0].EMail02 ? emailSend[0].EMail02 : ''}   )</i>              
      templateImage += ``;
      let itemEmail = 1;
      dados.forEach(function (item, index) {
        if (item.NomeGestor == nomeGestorEnviar) {
          templateImage += `
                    <table>
                      <tbody>
                        <tr>
                          <th colspan="2" class="titItme"> MOVIMENTAÇÃO ${itemEmail} </th>
                        </tr>
                        <tr>
                          <th>Nome Cliente</th>
                          <td> ${item.NomeCliente}  </td>
                        </tr>
                        <tr>
                          <th>Nome Fundo</th>
                          <td> ${item.NomeFundo} </td>
                        </tr>
                        <tr>
                          <th>Tipo Movimentação/th>
                          <td class='cor${item.IdTipoMovimentacao}'> ${item.NomeTipoMovimentacao} </td>
                        </tr>
                        <tr>
                          <th>Valor Movimentação</th>
                          <td> ${item.ValorMovimentacao.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' })} </td>
                        </tr>
                        <tr>
                          <th>Data Pedido</th>
                          <td> ${item.DataPedido} </td>
                        </tr>
                        <tr>
                          <th>Data Cotização</th>
                          <td> ${item.DataCotizacao} </td>
                        </tr>
                        <tr>
                          <th>Data Liquidação</th>
                          <td> ${item.DataLiquidacao} </td>
                        </tr>
                        <tr>
                          <th>Nome Banco</th>
                          <td> ${item.NomeBanco ? item.NomeBanco : '-'} </td>
                        </tr>
                        <tr>
                          <th>Agência</th>
                          <td> ${item.Agencia ? item.Agencia : '-'} </td>
                        </tr>
                        <tr>
                          <th>Conta</th>
                          <td> ${item.Conta ? item.Conta : '-'} </td>
                        </tr>
                      </tbody>
                    </table>
                    <br><br>
                   `;
          itemEmail++;
        }
      });

      templateImage += `
                    <br>
                    Att
                    <br>
                    Comercial
                    <br><br>
                    Philos Invest – Agente Autônomo de investimentos
                    <br>
                    ___________________________________________
                    <br><br>
                    Movimentações  - Philos Investimentos <br>
                    Tel: (21) 2512-2766<br>
                    Av. Ataulfo de Paiva, 1120 /  Sala 501 <br>
                    Leblon - Rio de Janeiro - RJ 22440-035<br>
                    <a href="https://www.philosinvest.com.br">https://www.philosinvest.com.br</a>

                    
                    <br><br> <br>
                     
                    </body>
                    </html> `;
      let message = `${templateImage}`;

      let emailTo = [];
      emailSend[0].EMail01 ? emailTo.push(emailSend[0].EMail01) : "";
      emailSend[0].EMail02 ? emailTo.push(emailSend[0].EMail02) : "";

      const arrEmailUnique = [...new Set(emailTo)]
      console.log(arrEmailUnique, '.....lista.....', emailTo);

      sgMail.setApiKey(process.env.SENDGRID_API_KEY_MOV);
      const msg = {
        // to: ['alexandreoibh1@gmail.com'], // Change to your recipient
        to: arrEmailUnique, // Change to your recipient
        cc: ['movimentacao@philosinvestimentos.com.br'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Movimentacao - Philos Investimentos<movimentacao@philosinvestimentos.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
      };

      return await sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error);
        });


    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }

  static async enviarEmailToken(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.APP_URL}/uploads/logo-philos_cor.png">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      if (template == 2) {
        templateImage = `
                <table style="width: 800px">
                    <tr>
                        <td>
                            <img style="width: 800px" src="${process.env.APP_URL}/uploads/logo-philos_cor_email2.fw.png">
                        </td>
                    </tr>
                </table>`;
      }

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
                <tr>
                    <td colspan="2" style="padding:5px;">
                      <li> com intuito de garantir mais segurança no seu acesso ao MEU MUNDO INVESTIMENTOS o processo de duas etapas fortalece seu acesso seguro</li>
                      <li> depois de logar com login e senha, um token é enviado ao seu email </li>
                      <li> após receber o token você tem dois minutos para usa-lo</li>
                      <li> expirando o tempo um novo pedido de token deverá ser feito na tela de login</li> 
                    </td>
                </tr>

            </table>
            `;
      message += `
                    <br>
                    Att
                    <br>
                    Comercial
                    <br><br>
                    Philos Invest – Agente Autônomo de investimentos
                    <br>
                    ___________________________________________
                    <br><br>
                    Movimentações  - Philos Investimentos <br>
                    Tel: (21) 2512-2766<br>
                    Av. Ataulfo de Paiva, 1120 /  Sala 501 <br>
                    Leblon - Rio de Janeiro - RJ 22440-035<br>
                    <a href="https://www.philosinvest.com.br">https://www.philosinvest.com.br</a>

                    <br><br>
                    <img  src="${process.env.APP_URL}/uploads/Philos_ email_ale.png">
                    <br><br> <br>
                     
                    `;


      let attachment = '';
      // let arquivo = 'PhilosInvest.pdf';
      // if (anexo == true) {
      //   let pathToAttachment = `${path}/${arquivo}`;
      //   attachment = fs.readFileSync(pathToAttachment).toString("base64");
      // }

      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const msg = {
        to: email, // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Philos Investimentos | Segurança Meu Mundo<meumundo@philosinvest.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
        // attachments: [
        //   {
        //     content: attachment,
        //     filename: arquivo,
        //     type: "application/pdf",
        //     disposition: "attachment",
        //   },
        // ],
      };

      sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error);
        });


    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }

  static async enviarEmailReset(
    req,
    res,
    email,
    assunto,
    titulo,
    subtitulo,
    mensagem,
    anexo,
    template
  ) {
    try {
      let path = resolve(__dirname, "..", "uploads");
      let templateImage = `
            <table style="border:1px solid #BFCFFF; width: 800px">
                <tr>
                    <td style="border-right: 1px solid #BFCFFF; padding:10px 30px 5px 20px; width: 200px">
                        <img style="width: 180px !important" src="${process.env.APP_URL}/uploads/logo-philos_cor.png">
                    </td>
                    <td style="width: 700px; padding-left:20px; color: #444444">
                        <span style="font-size:22px; font-weight: bold">${titulo}</span><br>
                        <span style="font-size:16px; font-weight: 300">${subtitulo}</span>
                    </td>
                </tr>
            </table>`;

      if (template == 2) {
        templateImage = `
                <table style="width: 800px">
                    <tr>
                        <td>
                            <img style="width: 800px" src="${process.env.APP_URL}/uploads/logo-philos_cor_email2.fw.png">
                        </td>
                    </tr>
                </table>`;
      }

      let message = `
            ${templateImage}
            <table style="width: 800px">
                <tr>
                    <td colspan="2" style="padding:10px;">
                    ${mensagem}
                    </td>
                </tr>
                <tr>
                    <td colspan="2" style="padding:5px;">
                     <li> a senha temporária tem validade por 5 minutos, após isso ela perde a validade  </li>
                     <li> assim que receber a senha você tem 5 minutos para logar no sistema  </li>
                     <li> depois de logar no sistema vá no menu Usuários -> Meus Dados e altere sua senha </li> 
                     <li> é possível fazer 3 resetes de senha, depois disso somente o assessor do cliente poderá fazer esse reset ou o Administrador da Philos </li>
                    </td>
                </tr>

            </table>
            `;
      message += `
                    <br>
                    Att
                    <br>
                    Comercial
                    <br><br>
                    Philos Invest – Agente Autônomo de investimentos
                    <br>
                    ___________________________________________
                    <br><br>
                    Movimentações  - Philos Investimentos <br>
                    Tel: (21) 2512-2766<br>
                    Av. Ataulfo de Paiva, 1120 /  Sala 501 <br>
                    Leblon - Rio de Janeiro - RJ 22440-035<br>
                    <a href="https://www.philosinvest.com.br">https://www.philosinvest.com.br</a>

                    <br><br>
                    <img  src="${process.env.APP_URL}/uploads/Philos_ email_ale.png">
                    <br><br> <br>
                     
                    `;


      let attachment = '';
      // let arquivo = 'PhilosInvest.pdf';
      // if (anexo == true) {
      //   let pathToAttachment = `${path}/${arquivo}`;
      //   attachment = fs.readFileSync(pathToAttachment).toString("base64");
      // }
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const msg = {
        to: [email], // Change to your recipient
        // cc: ['alexandreoibh@hotmail.com'],
        bcc: ['alexandreoibh@hotmail.com'],
        from: "Philos Investimentos | Segurança Meu Mundo<meumundo@philosinvest.com.br>", // Change to your verified sender
        subject: assunto,
        html: message,
        // attachments: [
        //   {
        //     content: attachment,
        //     filename: arquivo,
        //     type: "application/pdf",
        //     disposition: "attachment",
        //   },
        // ],
      };

      return await sgMail
        .send(msg)
        .then((response) => {
          console.log(response, "Email enviado");
          return response;

        })
        .catch((error) => {
          console.error(error);
        });


    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }


}

module.exports = Email;
