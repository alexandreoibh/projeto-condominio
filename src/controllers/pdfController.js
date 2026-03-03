"user strict";
const PDFDocument = require("pdfkit");
const fs = require("fs");
const { resolve } = require("path");
const html_to_pdf = require("html-pdf-node");

class Pdf {
  async getHtml(req, res) {
    let { corpo, pdfProduto } = req.body;
    let path = resolve(__dirname, "..", "uploads");
    let apelido = req.apelido;
    let arquivo = "pdf_produto_" + pdfProduto + ".pdf";
    let pathArquivo = `${path}/${arquivo}`;
    let dir = `${path}/produtos`;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    apelido = apelido.replace(".", "");
    apelido = apelido.replace(".", "");
    apelido = apelido.replace("@", "");

    dir = `${path}/produtos/${apelido}`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    pathArquivo = `${path}/produtos/${apelido}/${arquivo}`;
    // let imgSrc = 'file://' + path + '/logo-philos.png';

    let options = {
      format: "A4",
      path: pathArquivo,
      orientation: "portrait",
      header: {
        contents: "<img src='image path' />",
        height: "30mm",
      },
    };
    // Example of options with args //
    // let options = { format: 'A4', args: ['--no-sandbox', '--disable-setuid-sandbox'] };

    let cabecalho = `<link rel="stylesheet"  href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">`;
    cabecalho += `<br><img src='${process.env.APP_URL}/tmp/logo-philos_cor.png' style="width: 150px;position:relative;left:25px" /> <hr>`;
    let style = `<style>
                  hr{
                    border: 2px solid black;
                    border-collapse: collapse;
                  }
                    .card-header {
                      color: powderblue !important;
                      background:  powderblue !important;
                  }
                
                  .tableFundo{ 
                    width: 100% ;
                    
                }
                .classDaSuaTRouTD{
                    white-space: nowrap;  
                }
                .tableFundo tr td{
                    white-space: pre-wrap;
                 }
                
                .tableRetorno tr td{
                    white-space: pre-wrap;
                }
                .tableRetorno{ 
                    width: 100% ;
                }
                
                .tableRetorno tr td{
                    font-size: 11px;
                }
                
                .tableRetorno tr th{
                    white-space: pre-wrap;
                }
                
                .text-primary {
                    color:#349bb4 !important; 
                }
                
                .buttonConsultar{
                    position: relative;
                    top:28px;
                }
                
                .SweetAlert{
                    text-align: left;
                   }
                .SweetSuccess{
                    text-align: left;
                   }
                .divInfo{
                    width: 100%;
                    font-size: 12px;
                }  
                
                .titTable{
                    background-color:#6c757d !important;
                    color: white;
                    height: 61px;
                    text-align: left;
                }
                .titTableCotacao{
                    background-color:#6c757d !important;
                    color: white;
                    height: 31px;
                    text-align: left;
                }

                .titTableCotacaoLinha{
                  background-color:#6c757d !important;
                  color: white;
                  height: 11px;
                  text-align: left; 
                  font-size:12px !important;  
              }
              
              .tableFundoLinha th, td {
                  padding: 0.185rem !important;
                  vertical-align: top !important;
                  border-top: 1px solid #dee2e6 !important;
                  font-size:12px !important;
              }

              h5{
                font-size:12px !important;  
              }
              
              .tableFundo th, td{
                font-size:12px !important; 
              }

              .tableRetorno th, td{
                font-size:12px !important; 
              }
              
              .faGraph{
                font-size: 330px;
                position: relative;
                top: 35px;  
                left: 10%;
                cursor: pointer;
              }
              
              .label{
                  font-weight: bold;
              }
                </style>
                `;
    let conteudo = `<div class='col-md-12'>${cabecalho}${corpo}${style}</div>`;

    let file = { content: conteudo };

    html_to_pdf.generatePdf(file, options).then((pdfBuffer) => {
      // console.log("PD11111111111111111F Buffer:-", pdfBuffer);
      if (pdfBuffer) {
        return res.send({ dados: true });
      } else {
        return res.send({ dados: false });
      }
    });
  }

  

  async get(req, res) {
    var pdfDoc = new PDFDocument();
    let path = resolve(__dirname, "..", "uploads");
    let arquivo = "text_alignment.pdf";
    let pathToAttachment = `${path}/${arquivo}`;

    pdfDoc.pipe(fs.createWriteStream(pathToAttachment));

    pdfDoc.text("<table><tr><td></td></td></table>", {
      align: "left",
    });
    pdfDoc.text("This text is at the center", { align: "center" });
    pdfDoc.text("This text is right aligned", { align: "right" });
    pdfDoc.text(
      "This text needs to be slightly longer so that we can see that justification actually works as intended",
      { align: "justify" }
    );

    pdfDoc.end();
    return res.send({ dados: "Successo Gerado PDf" });
  }


  
}

module.exports = Pdf;
