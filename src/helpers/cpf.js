// Normalização e validação de CPF (dígitos verificadores, módulo 11).

function normalizarCpf(value) {
  const digitos = String(value ?? '').replace(/\D/g, '');
  return digitos || null;
}

function cpfValido(value) {
  const cpf = normalizarCpf(value);
  if (!cpf || cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * (base.length + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const digito1 = calcularDigito(cpf.slice(0, 9));
  const digito2 = calcularDigito(cpf.slice(0, 10));
  return digito1 === Number(cpf[9]) && digito2 === Number(cpf[10]);
}

module.exports = { normalizarCpf, cpfValido };
