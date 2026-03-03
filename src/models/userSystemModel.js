"use strict";
const ConnectDBHelper = require("../service/connectDBHelper")();


class userModel {
  async getUser(req, res) {
    let {
      status,
      id,
      username,
      email,
      username_assessor,
      pagina,
      ApelidoDetalhar,
      cpf_search,
      meusdados,
      cnpj_search,
      relacionamento_search,
      excel
    } = req.query;
    let where = "";
    const limit = excel == 'true' ? 10000 : 50;
    const page = pagina - 1;
    const start = page * limit;
    let Apelido = req.apelido;
    let IdPerfil = req.IdPerfil;
    let idcliente = req.idcliente;

    if (IdPerfil == 1) {
      where += ` and (a.IdAgente = '${idcliente}'  )  `;
    }

    if (username_assessor) {
      where += ` and (a.IdAgente = '${username_assessor}'  )  `;
    }
    if (status) {
      if (status == 0) {
        where += ` and (a.Ativo =  ${status} or a.Ativo is null)  `;
      } else {
        where += ` and (a.Ativo =  ${status} )  `;
      }
    }
    if (cpf_search) {
      where += ` and (a.CPF =  '${cpf_search}' )  `;
    }
    if (cnpj_search) {
      where += ` and (a.CNPJ =  '${cnpj_search}' )  `;
    }
    if (ApelidoDetalhar) {
      where += ` and (a.Apelido =  '${ApelidoDetalhar}' )  `;
    }
    if (username) {
      where += ` and (a.NomeCliente like '%${username}%' or a.Apelido like '%${username}%' )  `;
    }
    if (email) {
      where += ` and (a.EMail01 like  '%${email}%' )  `;
    }
    if (id) {
      where += ` and (a.IdCliente =  ${id} )  `;
    }
    if (meusdados) {
      where += ` and (a.Apelido =  '${Apelido}' )  `;
    }

    const query = `SELECT 
                    a.* ,
                    b.NomeCoTitular,
                    CONVERT(VARCHAR,a.DataNasc,103) as DataNasc2,
                    CONVERT(VARCHAR,a.DataCriacao,103) as DataCriacao2,
                    total = COUNT(*) OVER(),
                    total_paginas = (COUNT(*) OVER())/${limit},
                    (SELECT
                      top 1 c.NomeAgente as Agente
                      FROM [dbo].[Agentes] c
                      where a.IdAgente = c.IdAgente)as Agente       
                    FROM [dbo].[Clientes] a
                    left join CoTitulares b
                    on(a.IdCoTitular=b.IdCoTitular)
                    where 1=1 
                    ${where}
                    ORDER BY a.NomeCliente 
                    OFFSET @0 ROWS FETCH NEXT @1 ROWS ONLY;`;
    let params = [
      {
        tipo: "Int",
        value: start,
      },
      {
        tipo: "Int",
        value: limit,
      },
    ];
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }


  async getAssessor(req, res) {
    let {
      id,
      username,
      pagina,
    } = req.query;
    let where = "";
    const limit = 50;
    const page = pagina - 1;
    const start = page * limit;

    if (username) {
      where += ` and (a.NomeAgente like '%${username}%' )  `;
    }
    if (id) {
      where += ` and (a.IdAgente =  ${id} )  `;
    }


    const query = `SELECT 
                    a.* ,
                    CONVERT(VARCHAR,a.DataCriacao,103) as DataCriacao2,
                    (select count(*) 
                        from  [dbo].[Agentes] a
                        where 1=1 
                        ${where}
                        )as total,
                    (select round(count(*)/${limit},4) 
                         from  [dbo].[Agentes] a
                        where 1=1 
                        ${where})as total_paginas,
                    (select (count(b.IdAgente)) 
                         from  [dbo].[Clientes] b
                        where b.IdAgente=a.IdAgente 
                        ${where}
                        )as total_cliente         
                    FROM [dbo].[Agentes] a
                    where 1=1 
                    ${where}
                    ORDER BY a.status desc, a.NomeAgente 
                    OFFSET @0 ROWS FETCH NEXT @1 ROWS ONLY;`;
    let params = [
      {
        tipo: "Int",
        value: start,
      },
      {
        tipo: "Int",
        value: limit,
      },
    ];
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }



  async getUserAssesor(req, res) {
    let where = "";
    let idcliente = req.idcliente;

    where += ` and (a.IdAgente = '${idcliente}'  )  `;

    const query = `SELECT 
                    a.* ,
                    '' as DataNasc2,
                    '' as DataCriacao2,
                    '1' as total,
                    '1' as total_paginas,
                    '' as Agente       
                    FROM [dbo].[Agentes] a
                    where 1=1 
                    ${where}
                    `;
    console.log('AAAA', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }



  async getUsersBank(req, res) {
    let Apelido = req.apelido;
    let where = "";
    let { ApelidoDetalhar } = req.query;

    if (Apelido && typeof ApelidoDetalhar === "undefined") {
      where += ` and (c1.Apelido =  '${Apelido}' )  `;
    }

    if (ApelidoDetalhar) {
      where += ` and (c1.Apelido =  '${ApelidoDetalhar}' )  `;
    }

    const query = `select c1.CPF as CPF, 
                    c1.Telefone_Cel as Celular, 
                    c1.Telefone_Res as Telefone,
                    c1.Email01 as Email, 
                    c1.Apelido as Apelido, 
                    FORMAT (C1.DataNasc, 'dd-MM-yyyy') as DataNascimento, 
                    c4.NomeAgente as Agente, 
                    c4.IdAgente, 
                    c2.Agencia	as Agencia,
                    c2.Conta as Conta, 
                    c2.IdBanco, 
                    c3.CodBanco as CodigoBanco, 
                    c3.NomeBanco as NomeBanco, 
                    c1.CodClienteBrain as CodigoSmart,
                    c1.EnderecoResidencial as Endereco,
                    c1.ComplementoResidencial as Complemento, 
                    c1.BairroResidencial as Bairro, 
                    c1.CepResidencial as CEP, 
                    c1.CidadeResidencial as Cidade, 
                    c1.EstadoResidencial as Estado,
                    c5.NomePerfil as TipoPerfil,
                    c2.IdDadosBancarios,
                    c1.IdCliente

                        from [dbo].[clientes] as c1  
                    inner join [dbo].[DadosBancarios] as c2 on c2.Idcliente = c1.Idcliente
                    left join [dbo].[Bancos] as c3 on c3.IdBanco = c2.IdBanco
                    left join [dbo].[Agentes] as c4 on c4.IdAgente = c1.IdAgente 
                    left join [dbo].[Perfil] as c5 on c5.IdPerfil = c1.IdPerfil
                    where 1=1 
                    ${where}
                    `;

    let params = [];
    console.log('resultBank queryqueryqueryqueryqueryquery', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }


  async getUsersCotitular(req, res) {
    let Apelido = req.apelido;
    let where = "";
    let { ApelidoDetalhar } = req.query;

    if (Apelido && typeof ApelidoDetalhar === "undefined") {
      where += ` and (a.Apelido =  '${Apelido}' )  `;
    }

    if (ApelidoDetalhar) {
      where += ` and (a.Apelido =  '${ApelidoDetalhar}' )  `;
    }

    const query = `select b.*

                        from [dbo].[clientes] as a  
                    left join [dbo].[CoTitulares] as b on a.IdCoTitular = b.IdCoTitular
                    where 1=1 
                    ${where}
                    `;

    let params = [];
    console.log('resultBank getUsersCotitulargetUsersCotitulargetUsersCotitulargetUsersCotitular', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getAllBanks(req, res) {
    const query = `select *
                    from  [dbo].[Bancos] 
                    order by NomeBanco
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getAssessores(req, res) {
    const query = `SELECT a.NomeAgente as Agente,
                    a.IdAgente
                    FROM [dbo].[Agentes] a  
                    where status=1
                    group by a.NomeAgente,a.IdAgente
                    order by a.NomeAgente  
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getClienteAssessores(req, res) {
    const query = `SELECT a.Apelido,a.Agente,b.IdCliente, b.NomeCliente
                    FROM [dbo].[V_Consulta_Clientes] a
                    left join [dbo].[Clientes] b 
                    on(a.Apelido=b.Apelido)
                    group by a.Apelido,a.Agente,b.IdCliente, b.NomeCliente
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getAssessoresAgente(req, res) {
    const query = `SELECT a.IdAgente, a.NomeAgente
                    FROM [dbo].[Agentes] a
                    order by  a.NomeAgente asc
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getListGestoraFundos(req, res) {
    const query = `SELECT  a.NomeGestor, a.IdGestor
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where b.NomeContato='GERAL'
											group by a.NomeGestor, a.IdGestor
											order by 1
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getListAdministradoraFundos(req, res) {
    const query = `SELECT a.IdAdministrador, a.NomeAdministrador
                    from Administradores  a
                    group by a.NomeAdministrador, a.IdAdministrador
										order by 1
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getListPerfilFundos(req, res) {
    const query = `	select a.IdPerfil, a.NomePerfil
                    from Perfil a
                    group by a.IdPerfil, a.NomePerfil
                    order by a.NomePerfil
                    `;

    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getLogin(req, res) {
    let { login, password } = req.query;
    let where = "";

    if (isNaN(login)) {
      where += `and (a.Apelido =  '${login}'  )`;
    } else {
      where += ` and ( a.CodigoSmart =  '${login}'  )  `;
    }

    const query = `SELECT top 1
                      a.*, b.IdCliente,c.CodigoSmart as SSSS,
                      b.NomeCliente, b.SituacaoPatrimonial, b.CNPJ,
                      b.Ativo
                  FROM [dbo].[V_Consulta_Clientes] a 
                  left join [dbo].[Clientes] b 
                  on(a.Apelido=b.Apelido) 
                  left join [dbo].[V_Consulta_Clientes_CodigoSmart] c 
                  on(a.Apelido=c.Apelido)  
                  Where 1=1 
                    ${where}
                    `;
    console.log('query', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getLoginAssessor(req, res) {
    let { login } = req.query;
    let where = "";

    where += ` and (a.NomeAgente =  '${login}' )  `;

    const query = `SELECT top 1
                      a.NomeAgente as Apelido,
                      a.IdAgente as IdCliente,
                      a.IdUsuario as SSSS,
                      '' as NomeCliente
                  FROM [dbo].[Agentes] a 
                  Where 1=1 
                    ${where}
                    `;
    let params = [];
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getLoginOthers(req, res) {
    let { login, password } = req.query;
    let where = "";

    where += ` and (a.NomeAgente =  '${login}' )  `;
    if (password) {
      //where += ` and (a.password =  '${Apelido}' )  `;
    }

    const query = `SELECT top 1
                      a.NomeAgente as Apelido,
                      a.IdAgente as IdCliente,
                      a.IdUsuario as SSSS
                  FROM [dbo].[Agentes] a 
                  Where 1=1 
                    ${where}
                    `;
    let params = [];

    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }

  async getJwt(apelido) {
    const query = `SELECT top 1
                      a.*, b.IdCliente,c.CodigoSmart as SSSS, b.CPF, b.EMail01
                  FROM [dbo].[V_Consulta_Clientes] a 
                  left join [dbo].[Clientes] b 
                  on(a.Apelido=b.Apelido) 
                  left join [dbo].[V_Consulta_Clientes_CodigoSmart] c 
                  on(a.Apelido=c.Apelido)  
                  Where  a.Apelido = '${apelido}'
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query);
    return result;
  }

  async getJwtAssessor(apelido) {
    const query = `SELECT top 1
                        a.NomeAgente as Apelido,
                        a.IdAgente as IdCliente,
                        a.IdUsuario as SSSS,
                        '' as Agente,
                        '' as CPF
                    FROM [dbo].[Agentes] a 
                  Where  a.NomeAgente = '${apelido}'
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query);
    return result;
  }


  async getClientes(apelido) {
    const query = `SELECT 
                        b.IdCliente, b.Apelido
                    FROM [dbo].[V_Consulta_Clientes] a 
                    left join [dbo].[Clientes] b 
                    on(a.Apelido=b.Apelido) 
                    Where  a.Agente = '${apelido}'
                    group by b.IdCliente, b.Apelido
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query);
    return result;
  }


  async getUserMovimentacoes(req, res) {
    let {
      type,
      search,
      pagina
    } = req.query;
    let where = "";
    const limit = 50;
    const page = pagina - 1;
    const start = page * limit;
    let Apelido = req.apelido;

    if (type == 'op1') {
      where += ` and (a.NomeCliente like '%${search}%' or a.Apelido like '%${search}%' )  `;
    }
    if (type == 'op2') {
      where += ` and (a.NomeCliente like '%${search}%'  )  `;
    }
    if (type == 'op3') {
      where += ` and (a.CodClienteTema like '%${search}%'  )  `;
    }
    if (type == 'op4') {
      where += ` and (a.Apelido in (select c.Apelido from [dbo].[V_Consulta_Clientes] c where c.Agente like '%${search}%' )   )  `;
    }
    if (type == 'op5') {
      where += ` and ( a.Apelido like '%${search}%' )  `;
    }

    const query = `SELECT 
                    a.* ,
                    co.NomeCoTitular,
                    CONVERT(VARCHAR,a.DataNasc,103) as DataNasc2,
                    CONVERT(VARCHAR,a.DataCriacao,103) as DataCriacao2,
                    (select count(*) 
                        from  [dbo].[Clientes] a
                        where 1=1 
                        ${where}
                        )as total,
                    (select round(count(*)/${limit},4) 
                         from  [dbo].[Clientes] a
                        where 1=1 
                        ${where})as total_paginas,
                    (SELECT 
                      top 1 c.Agente   
                      FROM [dbo].[V_Consulta_Clientes] c  
                      where c.Apelido = a.Apelido)as Agente       
                    FROM [dbo].[Clientes] a
                    left join [dbo].[CoTitulares] co
                      on(a.IdCotitular = co.IdCoTitular) 
                    where 1=1 
                    ${where}
                    ORDER BY a.NomeCliente 
                    OFFSET @0 ROWS FETCH NEXT @1 ROWS ONLY;`;

    let params = [
      {
        tipo: "Int",
        value: start,
      },
      {
        tipo: "Int",
        value: limit,
      },
    ];
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }


  async getFundosProdutos(req, res) {
    const query = `SELECT 
                    a.NomeFundo  as name, 
                    a.IdFundos as id,
                    (a.DataCriacao)as dt_cadastro     
                    FROM [dbo].[Fundos] a
                    ORDER BY a.NomeFundo 
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getFundosProdutoItem(req, res) {
    let {
      formProduto,
      formCnpjFundoEscolhido
    } = req.query;
    let where = "";
    where += formProduto ? ` and (FU.NomeFundo = '${formProduto}' )  ` : '';
    where += formCnpjFundoEscolhido ? ` and (FU.CNPJ = '${formCnpjFundoEscolhido}' )  ` : '';

    const query = `SET NOCOUNT ON
                    Select FU.IdFundos, 
                    IsNull(FU.CodFundoTema,0) As CodFundoTema, 
                    IsNull(FU.CodFundoGestor,0) As CodFundoGestor, 
                    IsNull(FU.NomeFundo, '-') As NomeFundo, 
                    IsNull(FU.CNPJ, '-') As CNPJ,
                    IsNull(FU.IdTipoCota,0) As IdTipoCota, 
                    IsNull(TC.NomeTipoCota, '-') As NomeTipoCota,
                    IsNull(FU.IdGestor,0) As IdGestor, 
                    IsNull(GE.NomeGestor, '-') As NomeGestor,
                    IsNull(FU.IdBanco,0) As IdBanco, 
                    IsNull(BA.NomeBanco, '-') As NomeBanco,
                    IsNull(FU.Agencia, '-') As Agencia,
                    IsNull(FU.Conta, '-') As Conta,
                    (SELECT top 1 a.NomeGestor 
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=GE.IdGestor
                      and b.NomeContato='GERAL')as AdminGestora_fundo,
                    (SELECT top 1 C.NomeAdministrador
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=GE.IdGestor
                      and b.NomeContato='GERAL')as AdminNomeAdministrador,  
                    (SELECT top 1 b.Email 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=GE.IdGestor
                        and b.NomeContato='GERAL')as AdminEmailAdministradora,  
                    (SELECT top 1 c.IdAdministrador 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=GE.IdGestor
                        and b.NomeContato='GERAL')as AdminIdAdministrador,    
                    IsNull(Upper(FU.CotizacaoAplicacao),'-') As CotizacaoAplicacao, 
                    IsNull(Upper(FU.LiquidacaoAplicacao),'-') As LiquidacaoAplicacao, 
                    IsNull(Upper(FU.CotizacaoResgate),'-') As CotizacaoResgate, 
                    IsNull(Upper(FU.LiquidacaoResgate),'-') As LiquidacaoResgate, 
                    IsNull(FU.IdStatusInvestimento,0) As IdStatusInvestimento, 
                    IsNull(SI.NomeStatusInvestimento, '-') As NomeStatusInvestimento,
                    IsNull(FU.IdPublicoAlvo,0) As IdPublicoAlvo, 
                    IsNull(PU.NomePublicoAlvo, '-') As NomePublicoAlvo,
                    IsNull(FU.AplicacaoInicial, 0) As AplicacaoInicial, 
                    IsNull(FU.SaldoMinimo, 0) As SaldoMinimo,
                    IsNull(FU.MovimentacaoMinima, 0) As MovimentacaoMinima, 
                    IsNull(FU.HorarioAplicacao, '-') As HorarioAplicacao,
                    IsNull(FU.HorarioResgate, '-') As HorarioResgate,
                    Case When FU.Penalty = 'False' then Upper('NÃO POSSUI')Else 'SIM' End As Penalty, 
                    Isnull(FU.ValorPenalty,0) As ValorPenalty, 
                    IsNull(Convert(Varchar(500),FU.CotizaPenalty),'-') As CotizaPenalty, 
                    IsNull(Convert(Varchar(500),FU.LiquidaPenalty),'-') As LiquidaPenalty, 
                    IsNull(FU.TxAdm,0) As TxAdm, 
                    IsNull(FU.TxPFEE,0) As TxPFEE, 
                    IsNull(FU.IdPeriodoPfee,0) As IdPeriodoPfee, 
                    IsNull(PP.NomePeriodoPfee, '-') As NomePeriodoPfee, 
                    IsNull(FU.IdBenchMark,0) As IdBenchMark,
                    IsNull(BM.NomeBenchMark, '-') As NomeBenchMark,
                    IsNull(FU.IdEstrategia,0) As IdEstrategia, 
                    IsNull(ES.NomeEstrategia, '-') As NomeEstrategia,
                    IsNull(FU.IdPerfilCCN,0) As IdPerfilCCN, 
                    IsNull(PCCN.NomePerfil, '-') As NomePerfilCCN, 
                    IsNull(FU.IdPerfilAdm,0) As IdPerfilAdm, 
                    IsNull(PADM.NomePerfil, '-') As NomePerfilADM, 
                    IsNull(FU.Deflator,0) As Deflator, 
                    IsNull(FU.IdTipoDia,0) As IdTipoDia, 
                    IsNull(TD.NomeTipoDia, '-') As NomeTipoDia,
                    IsNull(Convert(Varchar(12),FU.DataInicioFundo,103),'-') As DataInicioFundo, 
                    IsNull(Convert(Varchar(12),FU.DataInicioCCN,103),'-') As DataInicioCCN, 
                    --Case When FU.DataEncerramento is null Then '' Else FU.DataEncerramento End As DataEncerramento, 
                    IsNull(Convert(Varchar(12), FU.DataEncerramento, 103),'-') As DataEncerramento,
                    IsNull(Convert(Varchar(12),FU.DataCriacao,103),'-') As DataCriacao, 
                    Case When FU.FIC = 'False' then Upper('NÃO POSSUI') Else 'SIM' End As FIC,
                    ISNULL(FU.CNPJFundoMaster,'-') As CNPJFundoMaster,
                    IsNull(FU.IdBenchMarkFundoCCN,0) As IdBenchMarkFundoCCN,
                    IsNull(BM2.NomeBenchMark, '-') As NomeBenchMarkFundoCCN,
                    IsNull(FU.IdAdministrador, '-') As IdAdministrador,
                    IsNull(A.NomeAdministrador, '-') As NomeAdministrador,
                    IsNull(FU.CodFundoBrain,0) As CodFundoBrain 
                    
                    From Fundos FU 
                    
                    LEFT OUTER JOIN
                    TipoCota TC
                    on FU.IdTipoCota = TC.IdTipoCota
                    
                    LEFT OUTER JOIN
                    Gestores GE
                    on FU.IdGestor = GE.IdGestor
                    
                    LEFT OUTER JOIN
                    Bancos BA
                    on FU.IdBanco = BA.IdBanco
                    
                    LEFT OUTER JOIN
                    StatusInvestimentos SI 
                    on FU.IdStatusInvestimento = SI.IdStatusInvestimento
                    
                    LEFT OUTER JOIN
                    PublicoAlvo PU
                    on FU.IdPublicoAlvo = PU.IdPublicoAlvo
                    
                    LEFT OUTER JOIN
                    PeriodoPfees PP
                    on FU.IdPeriodoPfee = PP.IdPeriodoPfee
                    
                    LEFT OUTER JOIN
                    BenchMarks BM
                    on FU.IdBenchMark = BM.IdBenchMark
                    
                    LEFT OUTER JOIN
                    Estrategias ES
                    on FU.IdEstrategia = ES.IdEstrategia
                    
                    LEFT OUTER JOIN
                    Perfil PCCN
                    on FU.IdPerfilCCN = PCCN.IdPerfil
                    
                    LEFT OUTER JOIN
                    Perfil PADM
                    on FU.IdPerfilAdm = PADM.IdPerfil
                    
                    LEFT OUTER JOIN
                    TipoDias TD
                    on FU.IdTipoDia = TD.IdTipoDia
                    
                    LEFT OUTER JOIN
                    BenchMarks BM2
                    on FU.IdBenchMarkFundoCCN = BM2.IdBenchMark

                    LEFT OUTER JOIN
                    Administradores A
                    on FU.IdAdministrador = A.IdAdministrador
                    where 1=1 
                    ${where}
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getListaFundosProdutos(req, res) {
    let {
      pagina,
      excel,
      nome_fundo_search,
      gestora_search,
      administradora_search,
      perfil_search,
      formCnpj
    } = req.query;
    let where = "";
    const limit = excel == 'true' ? 10000 : 50;
    const page = pagina - 1;
    const start = page * limit;
    // console.log('AAAAAA', req.query);

    where += nome_fundo_search ? ` and (FU.NomeFundo like '%${nome_fundo_search}%' )  ` : '';
    where += gestora_search ? ` and (GE.IdGestor = '${gestora_search}' )  ` : '';
    where += administradora_search ? ` and (GE.IdGestor = '${administradora_search}' )  ` : '';
    where += perfil_search ? ` and (PCCN.IdPerfil = '${perfil_search}' )  ` : '';
    where += formCnpj ? ` and (FU.CNPJ = '${formCnpj}' )  ` : '';

    const query = `SET NOCOUNT ON
                    Select 
                    total = COUNT(*) OVER(),
                    total_paginas = (COUNT(*) OVER())/${limit},
                    FU.IdFundos, 
                    IsNull(FU.CodFundoTema,0) As CodFundoTema, 
                    IsNull(FU.CodFundoGestor,0) As CodFundoGestor, 
                    IsNull(FU.NomeFundo, '-') As NomeFundo, 
                    IsNull(FU.CNPJ, '-') As CNPJ,
                    IsNull(FU.IdTipoCota,0) As IdTipoCota, 
                    IsNull(TC.NomeTipoCota, '-') As NomeTipoCota,
                    IsNull(FU.IdGestor,0) As IdGestor, 
                    IsNull(GE.NomeGestor, '-') As NomeGestor,
                    IsNull(FU.IdBanco,0) As IdBanco, 
                    IsNull(BA.NomeBanco, '-') As NomeBanco,
                    IsNull(FU.Agencia, '-') As Agencia,
                    IsNull(FU.Conta, '-') As Conta,
                    (SELECT top 1 a.NomeGestor 
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=GE.IdGestor
                      and b.NomeContato='GERAL')as AdminGestora_fundo,
                    (SELECT top 1 C.NomeAdministrador
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=GE.IdGestor
                      and b.NomeContato='GERAL')as AdminNomeAdministrador,  
                    (SELECT top 1 b.Email 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=GE.IdGestor
                        and b.NomeContato='GERAL')as AdminEmailAdministradora,  
                    (SELECT top 1 c.IdAdministrador 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=GE.IdGestor
                        and b.NomeContato='GERAL')as AdminIdAdministrador,    
                    IsNull(Upper(FU.CotizacaoAplicacao),'-') As CotizacaoAplicacao, 
                    IsNull(Upper(FU.LiquidacaoAplicacao),'-') As LiquidacaoAplicacao, 
                    IsNull(Upper(FU.CotizacaoResgate),'-') As CotizacaoResgate, 
                    IsNull(Upper(FU.LiquidacaoResgate),'-') As LiquidacaoResgate, 
                    IsNull(FU.IdStatusInvestimento,0) As IdStatusInvestimento, 
                    IsNull(SI.NomeStatusInvestimento, '-') As NomeStatusInvestimento,
                    IsNull(FU.IdPublicoAlvo,0) As IdPublicoAlvo, 
                    IsNull(PU.NomePublicoAlvo, '-') As NomePublicoAlvo,
                    IsNull(FU.AplicacaoInicial, 0) As AplicacaoInicial, 
                    IsNull(FU.SaldoMinimo, 0) As SaldoMinimo,
                    IsNull(FU.MovimentacaoMinima, 0) As MovimentacaoMinima, 
                    IsNull(FU.HorarioAplicacao, '-') As HorarioAplicacao,
                    IsNull(FU.HorarioResgate, '-') As HorarioResgate,
                    Case When FU.Penalty = 'False' then Upper('NÃO POSSUI')Else 'SIM' End As Penalty, 
                    Isnull(FU.ValorPenalty,0) As ValorPenalty, 
                    IsNull(Convert(Varchar(500),FU.CotizaPenalty),'-') As CotizaPenalty, 
                    IsNull(Convert(Varchar(500),FU.LiquidaPenalty),'-') As LiquidaPenalty, 
                    IsNull(FU.TxAdm,0) As TxAdm, 
                    IsNull(FU.TxPFEE,0) As TxPFEE, 
                    IsNull(FU.IdPeriodoPfee,0) As IdPeriodoPfee, 
                    IsNull(PP.NomePeriodoPfee, '-') As NomePeriodoPfee, 
                    IsNull(FU.IdBenchMark,0) As IdBenchMark,
                    IsNull(BM.NomeBenchMark, '-') As NomeBenchMark,
                    IsNull(FU.IdEstrategia,0) As IdEstrategia, 
                    IsNull(ES.NomeEstrategia, '-') As NomeEstrategia,
                    IsNull(FU.IdPerfilCCN,0) As IdPerfilCCN, 
                    IsNull(PCCN.NomePerfil, '-') As NomePerfilCCN, 
                    IsNull(FU.IdPerfilAdm,0) As IdPerfilAdm, 
                    IsNull(PADM.NomePerfil, '-') As NomePerfilADM, 
                    IsNull(FU.Deflator,0) As Deflator, 
                    IsNull(FU.IdTipoDia,0) As IdTipoDia, 
                    IsNull(TD.NomeTipoDia, '-') As NomeTipoDia,
                    IsNull(Convert(Varchar(12),FU.DataInicioFundo,103),'-') As DataInicioFundo, 
                    IsNull(Convert(Varchar(12),FU.DataInicioCCN,103),'-') As DataInicioCCN, 
                    --Case When FU.DataEncerramento is null Then '' Else FU.DataEncerramento End As DataEncerramento, 
                    IsNull(Convert(Varchar(12), FU.DataEncerramento, 103),'-') As DataEncerramento,
                    IsNull(Convert(Varchar(12),FU.DataCriacao,103),'-') As DataCriacao, 
                    Case When FU.FIC = 'False' then Upper('NÃO POSSUI') Else 'SIM' End As FIC,
                    ISNULL(FU.CNPJFundoMaster,'-') As CNPJFundoMaster,
                    IsNull(FU.IdBenchMarkFundoCCN,0) As IdBenchMarkFundoCCN,
                    IsNull(BM2.NomeBenchMark, '-') As NomeBenchMarkFundoCCN,
                    IsNull(FU.IdAdministrador, '-') As IdAdministrador,
                    IsNull(A.NomeAdministrador, '-') As NomeAdministrador,
                    IsNull(FU.CodFundoBrain,0) As CodFundoBrain 
                    
                    From Fundos FU 
                    
                    LEFT OUTER JOIN
                    TipoCota TC
                    on FU.IdTipoCota = TC.IdTipoCota
                    
                    LEFT OUTER JOIN
                    Gestores GE
                    on FU.IdGestor = GE.IdGestor
                    
                    LEFT OUTER JOIN
                    Bancos BA
                    on FU.IdBanco = BA.IdBanco
                    
                    LEFT OUTER JOIN
                    StatusInvestimentos SI 
                    on FU.IdStatusInvestimento = SI.IdStatusInvestimento
                    
                    LEFT OUTER JOIN
                    PublicoAlvo PU
                    on FU.IdPublicoAlvo = PU.IdPublicoAlvo
                    
                    LEFT OUTER JOIN
                    PeriodoPfees PP
                    on FU.IdPeriodoPfee = PP.IdPeriodoPfee
                    
                    LEFT OUTER JOIN
                    BenchMarks BM
                    on FU.IdBenchMark = BM.IdBenchMark
                    
                    LEFT OUTER JOIN
                    Estrategias ES
                    on FU.IdEstrategia = ES.IdEstrategia
                    
                    LEFT OUTER JOIN
                    Perfil PCCN
                    on FU.IdPerfilCCN = PCCN.IdPerfil
                    
                    LEFT OUTER JOIN
                    Perfil PADM
                    on FU.IdPerfilAdm = PADM.IdPerfil
                    
                    LEFT OUTER JOIN
                    TipoDias TD
                    on FU.IdTipoDia = TD.IdTipoDia
                    
                    LEFT OUTER JOIN
                    BenchMarks BM2
                    on FU.IdBenchMarkFundoCCN = BM2.IdBenchMark

                    LEFT OUTER JOIN
                    Administradores A
                    on FU.IdAdministrador = A.IdAdministrador
                    where 1=1 
                    ${where}
                    ORDER BY FU.NomeFundo
                    OFFSET @0 ROWS FETCH NEXT @1 ROWS ONLY


                  `;
    let params = [
      {
        tipo: "Int",
        value: start,
      },
      {
        tipo: "Int",
        value: limit,
      },
    ];
    // console.log(params,'AAAAAAAAAAAAAAAA',query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res, params);
    return result;
  }


  async getMovimentacoes(req, res) {
    let { nomeCliente, nomeGestor, tipoMovimentacao, dtPedidoInicio, dtPedidoFim, typeDate, onCancel, all, cancelados } = req.query;
    let where = "";
    let top = ' top 1011111 ';

    if (all) {
      top = "";
    }

    if (onCancel || cancelados === 'true') {
      where += ` and (M.MovimentacaoCancelada <> 1 )  `;
    }

    if (nomeCliente) {
      where += ` and (M.IdCliente = '${nomeCliente}' )  `;
    }
    if (nomeGestor) {
      where += ` and (F.IdGestor= '${nomeGestor}' )  `;
    }
    if (tipoMovimentacao) {
      where += ` and (M.IdTipoMovimentacao = '${tipoMovimentacao}' )  `;
    }

  
    if (where == "" && !onCancel) {
      // where = ` and M.EmailGestorEnviado is null `;
    }

    if (typeDate == 'op2') {
      where += ` and (M.DataCotizacao >= '${dtPedidoInicio}' and M.DataCotizacao <= '${dtPedidoFim}')  `;
    } else if (typeDate == 'op3') {
      where += ` and (M.DataLiquidacao >= '${dtPedidoInicio}' and M.DataLiquidacao <= '${dtPedidoFim}')  `;
    } else {
      // where += ` and ((M.DataPedido >= '${dtPedidoInicio}' and M.DataPedido <= '${dtPedidoFim}') or (M.DataPedidoAgendamento >= '${dtPedidoInicio}' and M.DataPedidoAgendamento <= '${dtPedidoFim}')) `;
      where += ` and ((M.DataPedidoAgendamento >= '${dtPedidoInicio}' and M.DataPedidoAgendamento <= '${dtPedidoFim}')) `;
    }



    const query = `Select  ${top} M.IdMovimentacao, IsNull(M.IdUsuarioCriador,'0') As IdUsuarioCriador,
                    IsNull(U.NomeUsuario,'-') As NomeUsuarioCriador,
                    IsNull(M.IdUsuarioEditor,'0') As IdUsuarioEditor,
                    IsNull(UE.NomeUsuario,'-') As NomeUsuarioEditor,
                    M.IdTipoMovimentacao, 
                    TM.NomeTipoMovimentacao,
                    M.IdCliente, 
                    F.CNPJ As cnpj,
                    C.NomeCliente,
                    C.CPF as CpfCliente, 
                    co.CPF as CpfCotutular, 
                    M.IdFundo,
                    F.NomeFundo,
                    F.IdGestor,
                    G.NomeGestor,
                    G.CodGestorBrain,
                    Convert(Varchar(10),M.DataPedido,103) As DataPedido,
                    Case When M.Agendamento = 1 Then 'SIM' Else 'NÃO' End As Agendamento,
                    IsNull(Convert(Varchar(10),M.DataPedidoAgendamento,103),'-') As DataPedidoAgendamento,
                    Convert(Varchar(10),M.DataCotizacao,103) As DataCotizacao,
                    Convert(Varchar(10),M.DataLiquidacao,103) As DataLiquidacao,
                    Case When M.Penalty = 0 Then 'NÃO' Else 'SIM' End As Penalty,
                    IsNull(M.ValorPenalty,0) As ValorPenalty,
                    IsNull(Convert(Varchar(10),M.DataCotizacaoPenalty,103),'-') As DataCotizacaoPenalty, 
                    IsNull(Convert(Varchar(10),M.DataLiquidacaoPenalty,103),'-') As DataLiquidacaoPenalty, 
                    Case When M.EmailGestorEnviado = 1 Then 'E-MAIL ENVIADO' Else 'NÃO' End As EmailGestorEnviado, 
                    IsNull(M.ContatoTelefonico,'-') As ContatoTelefonico,
                    M.EmailGestorEnviado as codEmailEnviado ,
                    M.EmailClienteEnviado as EmailClienteEnviado ,
                    M.infogestora ,
                    IsNull(M.Observacao,'-') As ObservacaoGestor, 
                    IsNull(M.ObservacaoInterna,'-') As ObservacaoInterna,
                    M.ValorMovimentacao,
                    M.MovimentacaoCancelada,
                    IsNull(B.NomeBanco, '-') As NomeBanco,
                    IsNull(DB.Agencia, '-') As Agencia, 
                    IsNull(DB.Conta, '-') As Conta,
                    Case When M.TransfInterna = 1 Then 'SIM' Else 'NÃO' End As TransfInterna,
                    C.CodClienteBrain as CodClienteBrain,
                    (F.CodFundoBrain) As CodFundoBrain,
                    (SELECT top 1 a.NomeGestor 
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=G.IdGestor
                      and b.NomeContato='GERAL')as AdminGestora_fundo,
                      (SELECT top 1 C.NomeAdministrador
                      FROM [dbo].[Gestores] a
                      inner join [dbo].[Contatos] b
                      on(a.IdGestor = b.IdGestor)
                      inner join [dbo].Administradores c
                      on(a.IdAdministrador=c.IdAdministrador)
                      where a.IdGestor=F.IdGestor
                      and b.NomeContato='GERAL')as AdminNomeAdministrador,  
                      (SELECT top 1 b.Email 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=F.IdGestor
                        and b.NomeContato='GERAL')as AdminEmailAdministradora,  
                      (SELECT top 1 c.IdAdministrador 
                        FROM [dbo].[Gestores] a
                        inner join [dbo].[Contatos] b
                        on(a.IdGestor = b.IdGestor)
                        inner join [dbo].Administradores c
                        on(a.IdAdministrador=c.IdAdministrador)
                        where a.IdGestor=F.IdGestor
                        and b.NomeContato='GERAL')as AdminIdAdministrador

                    From 
                        Movimentacoes M
                      LEFT OUTER JOIN
                        Usuarios U
                      on M.IdUsuarioCriador =  U.IdUsuario
                      
                      LEFT OUTER JOIN
                        Usuarios UE
                      on M.IdUsuarioEditor =  UE.IdUsuario
                      
                      LEFT OUTER JOIN
                        TipoMovimentacoes TM
                      on M.IdTipoMovimentacao =  TM.IdTipoMovimentacao
                      
                      LEFT OUTER JOIN
                        Fundos F
                      on M.IdFundo = F.IdFundos
                      
                      LEFT OUTER JOIN
                        Gestores G
                      on F.IdGestor = G.IdGestor

                      LEFT OUTER JOIN
                        Clientes C
                      on M.IdCliente = C.IdCliente
                      
                      LEFT OUTER JOIN
                        DadosBancarios DB
                      on M.IdDadosBancarios = DB.IdDadosBancarios
                      
                      LEFT OUTER JOIN
                        Bancos B
                      on B.IdBanco = DB.IdBanco

                      left join [dbo].[CoTitulares] co
                      on(co.IdCotitular = C.IdCoTitular) 
                          
                    Where 1=1 
                    ${where}
                    order by M.IdMovimentacao desc
                  `;//
   
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getMovimentacoesRel(req, res) {
    let { nomeCliente, nomeGestor, tipoMovimentacao, dtPedidoInicio, dtPedidoFim, typeDate, onCancel, all } = req.query;
    let where = "";
    let top = ' top 10 ';

    if (all) {
      top = "";
    }

    if (onCancel) {
      // where += ` and (M.MovimentacaoCancelada <> 1 )  `;
    }

    if (nomeCliente) {
      where += ` and (M.IdCliente = '${nomeCliente}' )  `;
    }
    if (nomeGestor) {
      where += ` and (F.IdGestor= '${nomeGestor}' )  `;
    }
    if (tipoMovimentacao) {
      where += ` and (M.IdTipoMovimentacao = '${tipoMovimentacao}' )  `;
    }

    if (where == "") {
      // where = ` and M.EmailGestorEnviado is null `;
    }

    if (typeDate == 'op2') {
      where += ` and (M.DataCotizacao >= '${dtPedidoInicio}' and M.DataCotizacao <= '${dtPedidoFim}')  `;
    } else if (typeDate == 'op3') {
      where += ` and (M.DataLiquidacao >= '${dtPedidoInicio}' and M.DataLiquidacao <= '${dtPedidoFim}')  `;
    } else {
      where += ` and (M.DataPedido >= '${dtPedidoInicio}' and M.DataPedido <= '${dtPedidoFim}')  `;
    }


    const query = `Select  ${top} 
                    M.IdCliente,
                    C.NomeCliente,
										(select sum(MA.ValorMovimentacao)
										  from Movimentacoes MA
											where MA.IdCliente=M.IdCliente
											and MA.IdTipoMovimentacao=1)aplicacao,
											
											(select sum(MA.ValorMovimentacao)
										  from Movimentacoes MA
											where MA.IdCliente=M.IdCliente
											and MA.IdTipoMovimentacao=2)resgate,
											
											(select sum(MA.ValorMovimentacao)
										  from Movimentacoes MA
											where MA.IdCliente=M.IdCliente
											and MA.IdTipoMovimentacao=3)resgate_total,
											
                    C.CodClienteBrain as CodClienteBrain

                    From 
                        Movimentacoes M
                      LEFT OUTER JOIN
                        Usuarios U
                      on M.IdUsuarioCriador =  U.IdUsuario
                      
                      LEFT OUTER JOIN
                        Usuarios UE
                      on M.IdUsuarioEditor =  UE.IdUsuario
                      
                      LEFT OUTER JOIN
                        TipoMovimentacoes TM
                      on M.IdTipoMovimentacao =  TM.IdTipoMovimentacao
                      
                      LEFT OUTER JOIN
                        Fundos F
                      on M.IdFundo = F.IdFundos
                      
                      LEFT OUTER JOIN
                        Gestores G
                      on F.IdGestor = G.IdGestor

                      LEFT OUTER JOIN
                        Clientes C
                      on M.IdCliente = C.IdCliente
                      
                      LEFT OUTER JOIN
                        DadosBancarios DB
                      on M.IdDadosBancarios = DB.IdDadosBancarios
                      
                      LEFT OUTER JOIN
                        Bancos B
                      on B.IdBanco = DB.IdBanco

                      left join [dbo].[CoTitulares] co
                      on(co.IdCotitular = C.IdCoTitular) 
                          
                    Where 1=1 
                    ${where}
                    group by  
                    M.IdCliente, 
                    C.NomeCliente,
                    C.CodClienteBrain
         
                    order by C.NomeCliente desc
                  `;//and M.EmailGestorEnviado is null
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getOrgaosEmissores(req, res) {

    const query = `Select *
                   from  OrgaoEmissor
                   order by NomeOrgaoEmissor
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getCoTitulares(req, res) {

    const query = `Select NomeCotitular, IdCoTitular
                   from  CoTitulares
                   order by NomeCotitular
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getExisteApelido(req, res) {
    let { apelido } = req.query;
    const query = `Select *
                   from  Clientes
                   where Apelido = '${apelido}'
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getExisteCodBrain(req, res) {
    let { CodClienteBrain } = req.query;
    const query = `Select *
                   from  Clientes
                   where CodClienteBrain = '${CodClienteBrain}'
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getExisteCpfCnpj(req, res) {
    let { formCpfCnpj } = req.query;
    const query = `Select *, CONVERT(VARCHAR,DataCriacao,103) as DataCriacao2,'philos' as tipo
                   from  Clientes
                   where CPF = '${formCpfCnpj}'
                   or CNPJ = '${formCpfCnpj}'
                  `;

    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getExisteCpfCotitular(req, res) {
    let { formCpfCotitular } = req.query;
    const query = `Select *,CONVERT(VARCHAR,DataCriacao,103) as DataCriacao2
                   from  CoTitulares
                   where CPF = '${formCpfCotitular}'
                  `;

    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getExisteCpfCliente(req, res) {
    let { formCpfCotitular } = req.query;
    const query = `Select 'BaseCliente' as IdCoTitular,
                    NomeCliente as NomeCoTitular,
                    DataNasc,
                    Telefone_Cel as Telefone,
                    Identidade,
                    IdOrgaoEmissor,
                    EMail01 as Email,
                    CepResidencial as CEP,
                    EnderecoResidencial as Endereco,
                    EnderecoResidencial as logradouro,
                    ComplementoResidencial as Complemento,
                    BairroResidencial as Bairro,
                    CidadeResidencial as Cidade,
                    EstadoResidencial as Estado,
                    CONVERT(VARCHAR,DataCriacao,103) as DataCriacao2
                   from  Clientes
                   where CPF = '${formCpfCotitular}'
                  `;

    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }



  async getMovimentacoesClientes(req, res) {
    const query = `Select 
                  C.NomeCliente,C.IdCliente
                    From 
                        Movimentacoes M
                      inner JOIN
                        Clientes C
                      on M.IdCliente = C.IdCliente
                    Where M.MovimentacaoCancelada = 0 And 
                    M.IdMovimentacao not in (Select IdMovimentacao From CheckMovimentacaoAplicacao)
                    group by C.NomeCliente,C.IdCliente
                    order by C.NomeCliente
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getMovimentacoesNomeGestor(req, res) {
    const query = `Select 
                  G.NomeGestor,G.IdGestor
                  From 
                      Movimentacoes M
                  LEFT OUTER JOIN Fundos F
                    on M.IdFundo = F.IdFundos
                    inner JOIN Gestores G
                    on F.IdGestor = G.IdGestor
                  Where M.MovimentacaoCancelada = 0 And 
                  M.IdMovimentacao not in (Select IdMovimentacao From CheckMovimentacaoAplicacao)
                  group by G.NomeGestor,G.IdGestor
                  order by G.NomeGestor
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async postStoreMovimentacoes(req, res) {
    let { IdTipoMovimentacao,
      IdDadosBancarios,
      IdFundo,
      IdCliente,
      DataPedido,
      Agendamento,
      DataPedidoAgendamento,
      DataCotizacao,
      DataLiquidacao,
      Penalty,
      ValorPenalty,
      DataCotizacaoPenalty,
      DataLiquidacaoPenalty,
      Observacao,
      valorMovimentacao,
      ContatoTelefonico,
      ObservacaoInterna,
      infogestora,
    } = req.body.params;
    valorMovimentacao = valorMovimentacao.replace("R$", "");
    valorMovimentacao = valorMovimentacao.replace(".", "").replace(".", "").replace(".", "").replace(".", "");
    valorMovimentacao = valorMovimentacao.replace(",", ".");

    let TransfInterna = '';
    ValorPenalty = Penalty != 0 ? ValorPenalty : null;
    DataCotizacaoPenalty = Penalty != 0 ? DataCotizacaoPenalty : null;
    DataLiquidacaoPenalty = Penalty != 0 ? DataLiquidacaoPenalty : null;
    IdDadosBancarios = IdDadosBancarios ? IdDadosBancarios : null;


    const query = `insert into dbo.Movimentacoes(
                    IdTipoMovimentacao	,
                    IdDadosBancarios	,
                    IdFundo	,
                    IdCliente	,
                    DataPedido	,
                    Agendamento	,
                    DataPedidoAgendamento	,
                    DataCotizacao	,
                    DataLiquidacao	,
                    Penalty	,
                    ValorPenalty	,
                    DataCotizacaoPenalty	,
                    DataLiquidacaoPenalty	,
                    Observacao	,
                    ValorMovimentacao	,
                    MovimentacaoCancelada	,
                    MotivoMovimentacaoCancelada	,
                    ContatoTelefonico	,
                    ObservacaoInterna	,
                    IdUsuarioCriador	,
                    TransfInterna,
                    infogestora
                    )values(
                      '${IdTipoMovimentacao}'	,
                       ${IdDadosBancarios}	,
                      '${IdFundo}'	,
                      '${IdCliente}'	,
                      '${DataPedido}'	,
                      '${Agendamento}'	,
                      '${DataPedidoAgendamento}'	,
                      '${DataCotizacao}'	,
                      '${DataLiquidacao}'	,
                      '${Penalty}'	,
                       ${ValorPenalty}	,
                       ${DataCotizacaoPenalty}	,
                       ${DataLiquidacaoPenalty}	,
                      '${Observacao}'	,
                      '${valorMovimentacao}'	,
                      ''	,
                      ''	,
                      '${ContatoTelefonico}'	,
                      '${ObservacaoInterna}'	,
                      '${req.idcliente}'	,
                      '${TransfInterna}',
                      '${infogestora}'     );
                       SELECT SCOPE_IDENTITY() as id
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getGestoras(req, res) {
    const query = `Select 
                  G.*,
                  replace(G.CNPJ, ',', '.') AS cnpj_cor
                  From 
                      Gestores G
                   order by G.NomeGestor
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getCotas(req, res) {
    const query = `Select 
                   *
                  From 
                      TipoCota G
                   order by G.NomeTipoCota
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getTipoStatusInvestimento(req, res) {
    const query = `Select 
                   *
                  From 
                      StatusInvestimentos G
                   order by G.NomeStatusInvestimento
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getTipoEstrategias(req, res) {
    const query = `Select 
                   *
                  From 
                      Estrategias G
                   order by G.NomeEstrategia
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getTipoPerfil(req, res) {
    const query = `Select 
                   *
                  From 
                      Perfil G
                   order by G.NomePerfil
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }



  async getPublicoAlvo(req, res) {
    const query = `Select 
                   *
                  From 
                      PublicoAlvo G
                   order by G.NomePublicoAlvo
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getBenchmark(req, res) {
    const query = `Select 
                   *
                  From 
                      BenchMarks G
                   order by G.NomeBenchMark
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getPeriodosPfees(req, res) {
    const query = `Select 
                   *
                  From 
                      PeriodoPfees G
                   order by G.NomePeriodoPfee
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async getTipoDias(req, res) {
    const query = `Select 
                   *
                  From 
                      TipoDias G
                   order by G.NomeTipoDia
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getAdministradorFundo(req, res) {
    const query = `Select 
                   *
                  From 
                      Administradores G
                   order by G.NomeAdministrador
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }

  async putMovimentacoes(req, res) {
    let movimentacao = req.body.dados;
    let MotivoMovimentacaoCancelada = req.body.MotivoMovimentacaoCancelada;

    const query = `update   dbo.Movimentacoes
                    set MovimentacaoCancelada=1,
                     MotivoMovimentacaoCancelada = '${MotivoMovimentacaoCancelada}' 
                    where IdMovimentacao =  '${movimentacao.IdMovimentacao}' 
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async getExportExcel(req, res) {
    // console.log('AAAAAAAAAAAAAA');
  }

  async putEnvioEmail(req, res, IdsMovim) {
    let query = '';
    let result = '';
    // console.log('AAAA', IdsMovim);
    await IdsMovim.map(function (item, i) {
      query = `update   dbo.Movimentacoes
                   set EmailGestorEnviado=1
                   where IdMovimentacao =  '${item}' 
                    `;
      result = ConnectDBHelper.executeQueryAsync(query, res);
    });

    return result;
  }

  async putEnvioEmailCliente(req, res, IdsMovim) {
    let query = '';
    let result = '';
    console.log('AAAA', IdsMovim);
    await IdsMovim.filter(function (item, i) {
      query = `update   dbo.Movimentacoes
                   set EmailClienteEnviado=1
                   where IdMovimentacao =  '${item}' 
                    `;
      result = ConnectDBHelper.executeQueryAsync(query, res);
    });

    return result;
  }

  async getUserSaldoFundo(req, res) {
    let { Cod_Cli, Cod_atv } = req.query;
    Cod_Cli = Cod_Cli ? Cod_Cli : 0;
    Cod_atv = Cod_atv ? Cod_atv : 0;

    const query = `select top 1 Valor_Bruto As Saldo
                    from [SMART_STORGE].SGC_Storge.dbo.TB_RESULT_CARPA_RETORNO
                    where Cod_Cli = ${Cod_Cli}  
                    and Cod_atv = ${Cod_atv}
                    order by data_atualizacao desc
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;
  }


  async getEmailCliente(IdCliente) {

    const query = `select top 1 EMail01, EMail02
                    from [dbo].[Clientes]
                    where IdCliente = '${IdCliente}'  
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query);

    return result;
  }

  async getEmailGestora(IdGestor) {

    const query = `select top 100 Email
                    from [dbo].[Contatos]
                    where IdGestor = '${IdGestor}' 
                    and NomeContato='GERAL'
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query);
    return result;
  }

  async putSetStatusUser(req, res, ApelidoDetalhar, userAtivo) {
    let Ativo = userAtivo ? 1 : 0;
    const query = `update   dbo.Clientes
                    set Ativo = ${Ativo}
                    where Apelido =  '${ApelidoDetalhar}' 
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async putSetStatusAssessor(req, res, ApelidoDetalhar, userAtivo) {
    const { idAssessor, status } = req.body.params;

    let Ativo = status == 0 ? 1 : 0;
    const query = `update   dbo.Agentes
                    set status = ${Ativo}
                    where IdAgente =  '${idAssessor}' 
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async putSetDadosPessoaisUser(req, res, ApelidoDetalhar) {
    let dadosPessoais = req.body.params.dadosPessoais;
    // DataNasc = '${dadosPessoais.DataNasc.substr(6,4)+"/"+dadosPessoais.DataNasc.substr(3,2)+"/"+dadosPessoais.DataNasc.substr(0,2)}',
    const query = `update   dbo.Clientes
                    set NomeCliente = '${dadosPessoais.NomeCliente}',
                    DataNasc = '${dadosPessoais.DataNasc}',
                    EMail01 = '${dadosPessoais.EMail01}'
                    where Apelido =  '${ApelidoDetalhar}'
                    and (CPF = '${dadosPessoais.CPF}' 
                    or CNPJ = '${dadosPessoais.CPF}') 
                    `;
    console.log('AAAAAAAAA', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async putSetEnderecoResidencialUser(req, res, ApelidoDetalhar) {
    let dadosPessoais = req.body.params.dadosPessoais;

    const query = `update   dbo.Clientes
                    set EnderecoResidencial = '${dadosPessoais.EnderecoResidencial}',
                    ComplementoResidencial = '${dadosPessoais.ComplementoResidencial}',
                    BairroResidencial = '${dadosPessoais.BairroResidencial}',
                    CepResidencial = '${dadosPessoais.CepResidencial}',
                    CidadeResidencial = '${dadosPessoais.CidadeResidencial}',
                    EstadoResidencial = '${dadosPessoais.EstadoResidencial}'
                    where Apelido =  '${ApelidoDetalhar}'
                    and (CPF = '${dadosPessoais.CPF}' 
                    or CNPJ = '${dadosPessoais.CPF}') 
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async putSetDadosBancoUser(req, res, ApelidoDetalhar) {
    let dadosPessoais = req.body.params.dadosPessoais;

    const query = `update   dbo.DadosBancarios
                    set IdBanco = '${dadosPessoais.IdBanco}',
                    Agencia = '${dadosPessoais.Agencia}',
                    Conta = '${dadosPessoais.Conta}'
                    where IdDadosBancarios =  '${dadosPessoais.IdDadosBancarios}'
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async postSetDadosBancoUser(req, res, ApelidoDetalhar) {
    let dadosPessoais = req.body.params.dadosPessoais;
    let query = `insert into dbo.DadosBancarios(
                    IdBanco	,
                    Agencia	,
                    Conta	,
                    IdCliente	
                    )values(
                      '${dadosPessoais.IdBanco}'	,
                      '${dadosPessoais.Agencia}'	,
                      '${dadosPessoais.Conta}'	,
                      '${dadosPessoais.IdCliente}'	);
                  `;
    let result = ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async postSalvarFundo(req, res) {
    let dados = req.body.params.arrayDados;
    console.log('AWQ@DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', req.body.params);

    let query = `insert into dbo.Fundos(
                    CodFundoGestor	,
                    CodFundoTema	,
                    NomeFundo	,
                    CNPJ	,
                    CNPJFundoMaster	,
                    IdTipoCota	,
                    IdGestor	,
                    IdBanco	,
                    Agencia	,
                    Conta	,
                    CotizacaoAplicacao	,
                    LiquidacaoAplicacao	,
                    CotizacaoResgate	,
                    LiquidacaoResgate	,
                    IdStatusInvestimento	,
                    IdPublicoAlvo	,
                    AplicacaoInicial	,
                    SaldoMinimo	,
                    MovimentacaoMinima	,
                    HorarioAplicacao	,
                    HorarioResgate	,
                    Penalty	,
                    ValorPenalty	,
                    CotizaPenalty	,
                    LiquidaPenalty	,
                    TxAdm	,
                    TxPFEE	,
                    IdPeriodoPfee	,
                    IdBenchMark	,
                    IdEstrategia	,
                    IdPerfilCCN	,
                    IdPerfilAdm	,
                    Deflator	,
                    IdTipoDia	,
                    DataInicioFundo	,
                    DataInicioCCN	,
                    DataCriacao	,
                    FIC	,
                    IdBenchMarkFundoCCN	,
                    IdAdministrador	,
                    CodFundoBrain	
                    )values(
                      '${dados.formCodGestor}'	,
                      '${dados.formTema}'	,
                      '${dados.formNomeFundo}'	,
                      '${dados.formCnpj}',
                      '${dados.cnpjMaster}',
                      '${dados.formTipoCota}'	,
                      '${dados.formNomeGestor}'	,
                      '${dados.formBanco.split('|')[0]}'	,
                      '${dados.formAgenciaBanco}'	,
                      '${dados.formContaBanco}'	,
                      '${dados.formAplicacaoCotizacao}'	,
                      '${dados.formAplicacaoLiquidacao}'	,
                      '${dados.formResgateCotizacao}'	,
                      '${dados.formResgateLiquidacao}'	,
                      '${dados.formStatusInvestimento}'	,
                      '${dados.formPublicoAlvo}'	,
                      '${dados.formAplicacaoInicial.replace("R$", "").replace(".", "").replace(",", ".")}'	,
                      '${dados.formSaldoMinimo.replace("R$", "").replace(".", "").replace(",", ".")}'	,
                      '${dados.formMovimMinima.replace("R$", "").replace(".", "").replace(",", ".")}'	,
                      '${dados.formAplicacaoHorario}'	,
                      '${dados.formResgateHorario}'	,
                      '${dados.formPenalidade}'	,
                      '${dados.formPenalidadeValor.replace("R$", "").replace(".", "").replace(",", ".")}'	,
                      '${dados.formPenalidadeCotizacao}'	,
                      '${dados.formPenalidadeLiquidacao}'	,
                      '${dados.formTaxaAdmin.replace(".", "").replace(",", ".")}'	,
                      '0'	,
                      '${dados.formPeriodoPfee}'	,
                      '${dados.formTipobenchmark}'	,
                      '${dados.formEstrategia}'	,
                      '${dados.formPerfilCcn}'	,
                      '${dados.formPerfil}'	,
                      '.000000000000000000'	,
                      '${dados.formTipoDia}'	,
                      '${dados.formDtInicioFundo}'	,
                      '${dados.formDtInicioFundoCcn}'	,
                      getdate()	,
                      '',
                      '${dados.formTipobenchmarkCCN}'	,
                      '${dados.formIdAdministradoraFundo}'	,
                      '${dados.formBrain}'	
                      );
                  `;
    console.log('AAAAAAAAAAAAASSSSSSSSSSSSSSSSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', query);
    return ConnectDBHelper.executeQueryAsync(query, res);
  }

  async postEditFundo(req, res) {
    let dados = req.body.params.arrayDados;
    console.log('AWQ@DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', req.body.params);

    const query = `update   dbo.Fundos
                    set CodFundoGestor = '${dados.formCodGestor}',
                    CodFundoTema = '${dados.formTema}',
                    NomeFundo = '${dados.formNomeFundo}',
                    CNPJ = '${dados.formCnpj}',
                    CNPJFundoMaster = '${dados.cnpjMaster}',
                    IdTipoCota = '${dados.formTipoCota}',
                    IdGestor = '${dados.formNomeGestor}',
                    IdBanco = '${dados.formBanco.split('|')[0]}',
                    Agencia = '${dados.formAgenciaBanco}',
                    Conta = '${dados.formContaBanco}',
                    CotizacaoAplicacao = '${dados.formAplicacaoCotizacao}',
                    LiquidacaoAplicacao = '${dados.formAplicacaoLiquidacao}',
                    CotizacaoResgate = '${dados.formResgateCotizacao}',
                    LiquidacaoResgate = '${dados.formResgateLiquidacao}',
                    IdStatusInvestimento = '${dados.formStatusInvestimento}',
                    IdPublicoAlvo = '${dados.formPublicoAlvo}',
                    AplicacaoInicial = '${dados.formAplicacaoInicial.replace("R$", "").replace(".", "").replace(",", ".")}',
                    SaldoMinimo = '${dados.formSaldoMinimo.replace("R$", "").replace(".", "").replace(",", ".")}',
                    MovimentacaoMinima = '${dados.formMovimMinima.replace("R$", "").replace(".", "").replace(",", ".")}',
                    HorarioAplicacao = '${dados.formAplicacaoHorario}',
                    HorarioResgate = '${dados.formResgateHorario}',
                    Penalty = '${dados.formPenalidade}',
                    ValorPenalty = '${dados.formPenalidadeValor.replace("R$", "").replace(".", "").replace(",", ".")}',
                    CotizaPenalty = '${dados.formPenalidadeCotizacao}',
                    LiquidaPenalty = '${dados.formPenalidadeLiquidacao}',
                    TxAdm = '${dados.formTaxaAdmin.replace(".", "").replace(",", ".")}',
                    TxPFEE = '0',
                    IdPeriodoPfee = '${dados.formPeriodoPfee}',
                    IdBenchMark = '${dados.formTipobenchmark}',
                    IdEstrategia = '${dados.formEstrategia}',
                    IdPerfilCCN = '${dados.formPerfilCcn}',
                    IdPerfilAdm = '${dados.formPerfil}',
                    Deflator = '.000000000000000000',
                    IdTipoDia = '${dados.formTipoDia}',
                    DataInicioFundo = '${dados.formDtInicioFundo}',
                    DataInicioCCN = '${dados.formDtInicioFundoCcn}',
                    DataCriacao = getdate()	,
                    FIC = '',
                    IdBenchMarkFundoCCN = '${dados.formTipobenchmarkCCN}',
                    IdAdministrador = '${dados.formIdAdministradoraFundo}',
                    CodFundoBrain = '${dados.formBrain}'
                    where IdFundos =  '${dados.idFundos}' 
                    `;


    console.log('AAAAAAAAAAAAASSSSSSSSSSSSSSSSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', query);
    return ConnectDBHelper.executeQueryAsync(query, res);


  }

  async putAssessorUser(req, res, ApelidoDetalhar) {
    let dadosPessoais = req.body.params.dadosPessoais;

    const query = `update   dbo.Clientes
                    set IdAgente = '${dadosPessoais.IdAgente}'
                    where Apelido =  '${ApelidoDetalhar}'
                    and (CPF = '${dadosPessoais.CPF}' 
                    or CNPJ = '${dadosPessoais.CPF}') 
                    `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async pathUserCCN(req, res, idCotitularNovo) {
    let {
      usuarioDados,
      usuarioEnderecoRes,
      usuarioEnderecoTra
    } = req.body;

    let cpf = usuarioDados.formTipoCadastro == "CPF" ? usuarioDados.formCpfCnpj : '';
    let cnpj = usuarioDados.formTipoCadastro == "CNPJ" ? usuarioDados.formCpfCnpj : '';
    let assessor = usuarioDados.formAssessor.split('|')[0];
    let coTitular = usuarioDados.formCadCotitular == "SIM" ? usuarioDados.formIdCotitular ? usuarioDados.formIdCotitular : idCotitularNovo : null;
    let codClienteBrain = usuarioDados.formCodBrain.replace("_", "");

    const query = `insert into dbo.Clientes(
                    CodClienteTema	,
                    NomeCliente	,
                    FiliacaoPai	,
                    FiliacaoMae	,
                    Apelido	,
                    CPF	,
                    CNPJ	,
                    Identidade	,
                    IdOrgaoEmissor	,
                    DataNasc	,
                    DataInicio	,
                    DataCriacao	,
                    IdCotitular	,
                    IdAgente,
                    IdPerfil	,
                    Telefone_Res	,
                    Telefone_Cel	,
                    EMail01	,
                    EMail02	,
                    EnderecoResidencial	,
                    ComplementoResidencial,
                    BairroResidencial,
                    CepResidencial,
                    CidadeResidencial,
                    EstadoResidencial,
                    Observacao,
                    NomeEmpresaTrabalho,
                    CargoTrabalho,
                    TelefoneTrabalho,
                    EnderecoTrabalho,
                    ComplementoTrabalho,
                    CepTrabalho,
                    CidadeTrabalho,
                    EstadoTrabalho,
                    SituacaoPatrimonial,
                    CodClienteBrain,
                    Ativo
                    )values(
                      '0'	,
                      '${usuarioDados.formNomeUser ? usuarioDados.formNomeUser.toUpperCase() : ''}'	,
                      '${usuarioDados.formFiliacaoPai ? usuarioDados.formFiliacaoPai.toUpperCase() : ''}'	,
                      '${usuarioDados.formFiliacaoMae ? usuarioDados.formFiliacaoMae.toUpperCase() : ''}'	,
                      '${usuarioDados.formApelido ? usuarioDados.formApelido.toUpperCase() : ''}'	,
                      '${cpf}'	,
                      '${cnpj}'	,
                      '${usuarioDados.formIdentidade ? usuarioDados.formIdentidade : ''}'	,
                      ${usuarioDados.formIdOrgaoEmissor ? usuarioDados.formIdOrgaoEmissor : null}	,
                      '${usuarioDados.formDtNascimento ? usuarioDados.formDtNascimento : ''}'	,
                      getdate()	,
                      getdate()	,
                      ${coTitular}	,
                      '${assessor}'	,
                      null	,
                      '${usuarioDados.formFixo ? usuarioDados.formFixo : ''}'	,
                      '${usuarioDados.formMovel ? usuarioDados.formMovel : ''}'	,
                      '${usuarioDados.formEmail ? usuarioDados.formEmail.toUpperCase() : ''}'	,
                      '${usuarioDados.formEmail2 ? usuarioDados.formEmail2.toUpperCase() : ''}'	,
                      '${usuarioEnderecoRes.formLogradouroResidencial ? usuarioEnderecoRes.formLogradouroResidencial.toUpperCase() + ' ' + usuarioEnderecoRes.formNumeroResidencial.toUpperCase() : ''}'	,
                      '${usuarioEnderecoRes.formComplementoResidencial ? usuarioEnderecoRes.formComplementoResidencial.toUpperCase() : ''}'	,
                      '${usuarioEnderecoRes.formBairroResidencial ? usuarioEnderecoRes.formBairroResidencial.toUpperCase() : ''}'	,
                      '${usuarioEnderecoRes.formCepResidencial ? usuarioEnderecoRes.formCepResidencial : ''}'	,
                      '${usuarioEnderecoRes.formCidadeResidencial ? usuarioEnderecoRes.formCidadeResidencial.toUpperCase() : ''}',
                      '${usuarioEnderecoRes.formUfResidencial ? usuarioEnderecoRes.formUfResidencial.toUpperCase() : ''}',  
                      '${usuarioDados.formObservacao ? usuarioDados.formObservacao.toUpperCase() : ''}',  
                      '${usuarioDados.formEmpresaTrabalho ? usuarioDados.formEmpresaTrabalho.toUpperCase() : ''}',  
                      '${usuarioDados.formCargoTrabalho ? usuarioDados.formCargoTrabalho.toUpperCase() : ''}',  
                      '${usuarioDados.formTelefoneTrabalho ? usuarioDados.formTelefoneTrabalho : ''}',  
                      '${usuarioEnderecoTra.formLogradouroTrabalho ? usuarioEnderecoTra.formLogradouroTrabalho.toUpperCase() + ' ' + usuarioEnderecoTra.formNumeroTrabalho : ''} ' ,  
                      '${usuarioEnderecoTra.formComplementoTrabalho ? usuarioEnderecoTra.formComplementoTrabalho.toUpperCase() : ''}',  
                      '${usuarioEnderecoTra.formCepTrabalho ? usuarioEnderecoTra.formCepTrabalho : ''}',   
                      '${usuarioEnderecoTra.formCidadeTrabalho ? usuarioEnderecoTra.formCidadeTrabalho.toUpperCase() : ''}', 
                      '${usuarioEnderecoTra.formUfTrabalho ? usuarioEnderecoTra.formUfTrabalho.toUpperCase() : ''}', 
                      '${usuarioDados.formSituacaoPatrimonial ? usuarioDados.formSituacaoPatrimonial.replace("R", "").replace("$", "").replace(".", "").replace(".", "").replace(",", ".") : '0'}',   
                      '${codClienteBrain ? codClienteBrain : ''}', 
                      1 );
                       SELECT SCOPE_IDENTITY() as id
                  `;

    console.log('AAAA', query);
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

  async pathUserDadosBancarios(req, res, retornoUser) {
    let {
      usuarioDados,
      usuarioEnderecoRes,
      usuarioEnderecoTra,
      dadosBancarios
    } = req.body;
    let query;
    let result;

    dadosBancarios.map(function (item, i) {
      query = `insert into dbo.DadosBancarios(
                    IdBanco	,
                    Agencia	,
                    Conta	,
                    IdCliente	
                    )values(
                      '${item[0].formIdBanco ? item[0].formIdBanco : ''}'	,
                      '${item[0].formAgencia ? item[0].formAgencia : ''}'	,
                      '${item[0].formConta ? item[0].formConta : ''}'	,
                      '${retornoUser.recordset[0]['id'] ? retornoUser.recordset[0]['id'] : ''}'	);
                  `;
      result = ConnectDBHelper.executeQueryAsync(query, res);
    })
    return result;
  }

  async pathAssessorCCN(req, res) {
    let {
      usuarioDados,
      usuarioEnderecoRes,
      usuarioEnderecoTra,
      dadosBancarios
    } = req.body;
    let query;
    let result;

    query = `insert into dbo.Agentes(
                    CodAgenteTema	,
                    NomeAgente	,
                    IdUsuario	,
                    DataCriacao
                    )values(
                      31,
                      '${usuarioDados.formApelido ? usuarioDados.formApelido.toUpperCase() : ''}'		,
                      14,
                      getdate()
            	);
                  `;
    return result = ConnectDBHelper.executeQueryAsync(query, res);


  }

  async pathCoTitularCCN(req, res) {
    let {
      usuarioDados,
      usuarioEnderecoRes,
      usuarioEnderecoTra,
      usuarioEnderecoCotitular
    } = req.body;

    console.log('AAAAAQQQ', usuarioDados);
    console.log('1111111', usuarioEnderecoCotitular);

    let cpf = usuarioDados.formCpfCotitular;

    const query = `insert into dbo.CoTitulares(
                    NomeCoTitular	,
                    CPF	,
                    Identidade	,
                    IdOrgaoEmissor	,
                    DataNasc	,
                    Email	,
                    Telefone	,
                    Endereco	,
                    Complemento	,
                    CEP	,
                    Bairro	,
                    Cidade	,
                    Estado,
                    DataCriacao	
                    )values(
                      '${usuarioDados.formNomeUserCotitular.toUpperCase()}'	,
                      '${cpf}'	,
                      '${usuarioDados.formIdentidadeCotitular}'	,
                      '${usuarioDados.formIdOrgaoEmissorCotitular}'	,
                      '${usuarioDados.formDtNascimentoCotitular}'	,
                      '${usuarioDados.formEmailCotitular.toUpperCase()}'	,
                      '${usuarioDados.formMovelCotitular}'	,
                      '${usuarioEnderecoCotitular.formLogradouroCotitular.toUpperCase()}'	,
                      '${usuarioEnderecoCotitular.formNumeroCotitular.toUpperCase() + ' ' + usuarioEnderecoCotitular.formComplementoCotitular.toUpperCase()}'	,
                      '${usuarioEnderecoCotitular.formCepCotitular}'	,
                      '${usuarioEnderecoCotitular.formBairroCotitular.toUpperCase()}'	,
                      '${usuarioEnderecoCotitular.formCidadeCotitular.toUpperCase()}',
                      '${usuarioEnderecoCotitular.formUfCotitular.toUpperCase()}', 
                      getdate()	);
                       SELECT SCOPE_IDENTITY() as id
                  `;
    const result = await ConnectDBHelper.executeQueryAsync(query, res);
    return result;

  }

}




module.exports = function () {
  return userModel;
};

// module.exports = userModel;
