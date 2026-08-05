# Instruções para o Claude — Curso de Programação Estatística

## O que é este repositório

Livro Quarto (`project: book`) usado como material da disciplina **Programação
Estatística** da graduação em Estatística da UFSCar. Publicado em
<https://www.rafaelizbicki.com/prog-estat/>.

Autores: Andressa Cerqueira, Danilo Lourenço Lopes, Rafael Izbicki, Thiago Ramos.
Referência principal: Ross, *Simulation* (`@simulation_ross` em `references.bib`).

Os capítulos são os `.qmd` numerados na raiz, na ordem em que aparecem em
[_quarto.yml](_quarto.yml):

| Arquivo | Assunto |
|---|---|
| `0_R.qmd`, `0_py.qmd` | revisão de R e de Python (pré-requisito, não é o conteúdo do curso) |
| `1_intro.qmd` | motivação: por que simular |
| `2_pseudorandom.qmd` | geradores pseudoaleatórios (LCG) |
| `3_discrete_inversion.qmd`, `4_continuous_inversion.qmd` | método da inversão |
| `5_discrete_rejection.qmd`, `6_continuous_rejection.qmd` | método da rejeição |
| `7_transf.qmd` | transformações e misturas |
| `8_box_muller.qmd` | Box-Muller |
| `9_monte_carlo.qmd` | Monte Carlo e intervalos de confiança |
| `10_var_red.qmd` | redução de variância |
| `11_import.qmd` | amostragem por importância |

`notebooks/` guarda material usado ao vivo em aula; **não** faz parte do livro e
não precisa ser mantido em sincronia com os capítulos.

## Público-alvo

Alunos de graduação em Estatística que **já viram probabilidade** (v.a., densidade,
esperança, LGN, TCL) mas têm pouca experiência de programação. Ou seja:

- pode usar notação probabilística sem definir do zero;
- **não** pode assumir familiaridade com vetorização, `apply`/comprehensions,
  complexidade, ou boas práticas de código — quando usar algo assim, comente;
- prefira o código explícito e legível ao código curto e esperto. Um `for` que
  espelha o pseudo-algoritmo vale mais que um one-liner vetorizado, a menos que o
  ponto do trecho seja justamente eficiência.

## Como verificar mudanças

O Quarto não está no `PATH`; use o binário do RStudio:

```bash
QUARTO=/usr/lib/rstudio/resources/app/bin/quarto/bin/quarto
"$QUARTO" render 3_discrete_inversion.qmd   # um capítulo só (rápido)
"$QUARTO" render                            # livro inteiro (lento)
```

Renderizar o livro inteiro é caro. Para checar apenas se um trecho de código roda,
prefira executá-lo direto:

```bash
Rscript -e '<código R>'
poetry run python -c '<código Python>'
```

R 4.5.1 com `ggplot2`, `tidyr`, `dplyr`, `randomForest`, `plotrix`, `readr`, `gmp`,
`hflights`, `magrittr` já instalados.

### O Python do render vem do Poetry

As dependências Python estão declaradas em `pyproject.toml` + `poetry.lock`
(`numpy`, `scipy`, `matplotlib`, `pandas`, `scikit-learn`, `jupyterlab`). Ao
renderizar, o `reticulate` usa o virtualenv do Poetry, **não** o `python3` do
miniconda — e as versões diferem (o venv segue o `poetry.lock`, que é mais
antigo). Por isso o teste fiel de um chunk é com `poetry run python`, e não com
`python3` avulso.

Em uma máquina onde o venv ainda não existe, crie-o com:

```bash
poetry install --no-root --only main
```

O `--no-root` é obrigatório (o projeto declara um pacote `prog-stat` sem
diretório de código); `--only main` pula as ferramentas de dev.

**Se esse venv não existir, o sintoma é enganoso**: `poetry env info --path`
falha, o `reticulate` cai silenciosamente em um Python efêmero (gerenciado por
`uv`) que só tem `numpy`, e todo chunk com `matplotlib` derruba o build. Ao ver
`ModuleNotFoundError: No module named 'matplotlib'` no render, é isso — rode o
comando acima em vez de mexer no código do capítulo.

**Sempre execute o código que você escrever ou alterar** antes de dizer que está
pronto. O livro é renderizado de verdade: um chunk que quebra derruba o build.

## Estrutura de um capítulo

O padrão que os capítulos seguem (e que novos capítulos devem seguir):

1. `# Título do Capítulo` (H1, um por arquivo)
2. Um a três parágrafos situando o problema e ligando ao capítulo anterior
3. Teoria: definição/algoritmo, e quando couber uma justificativa de por que o
   método funciona
4. **Pseudo-algoritmo** em lista numerada, antes do código
5. `## Exemplo 1: ...`, `## Exemplo 2: ...` — numeração contínua dentro do capítulo
6. `## Exercícios` ao final

O par pseudo-algoritmo → implementação é a espinha dorsal do livro. Código sem
o algoritmo escrito antes em português/matemática é a exceção, não a regra.

## Blocos de código: sempre R **e** Python

Todo exemplo executável aparece nas duas linguagens, dentro de um tabset:

````markdown
::: {.panel-tabset group="language"}
# R

```{r}
# ...
```

# Python

```{python}
# ...
```
:::
````

Regras:

- `group="language"` sempre — é o que sincroniza a aba escolhida entre capítulos.
- Os cabeçalhos das abas são `# R` e `# Python` exatamente assim (o Quarto os
  converte em abas; não viram seções no sumário).
- **As duas versões devem fazer a mesma coisa**: mesmos parâmetros, mesma fórmula,
  mesmos rótulos de gráfico, mesmas saídas impressas. Divergência entre a aba R e a
  aba Python é bug, não estilo.
- Comentários no código em **português**, explicando o *porquê* do passo, na altura
  de quem está aprendendo.
- Nomes de variáveis em português (`n_lancamentos`, `valor_gerado`, `probabilidades`),
  seguindo o que já existe.

### Convenções de código

**R**: `snake_case`; `ggplot2` com `theme_minimal()` para gráficos; `<-` para
atribuição; `set.seed(...)` no início de qualquer chunk com aleatoriedade.

**Python**: `snake_case`; `matplotlib.pyplot` (sem seaborn); API legada do NumPy
(`np.random.uniform`, `np.random.seed`) — é o que o livro inteiro usa e é mais
simples para quem está começando; `np.random.seed(...)` no início de qualquer chunk
com aleatoriedade.

Use a **mesma semente** nas duas abas quando o exemplo comparar resultados
numéricos. Não introduza dependências novas (nem em R nem em Python) sem perguntar.

## Notação matemática

Padrão do livro:

| Uso | Escrever |
|---|---|
| variável aleatória | "v.a." no texto corrido |
| probabilidade / esperança | `\mathbb{P}(\cdot)`, `\mathbb{E}[\cdot]` |
| variância | `\text{Var}(\cdot)` |
| uniforme | `\text{Unif}(0,1)` |
| demais distribuições | `\text{Exp}(\lambda)`, `\text{Gama}(2,3)`, `N(0,1)`, `\text{Bernoulli}(p)` |
| estimador | `\hat{\theta}_n` |
| nº de simulações de Monte Carlo | `B` (reservando `n` para tamanho de amostra de dados reais) |

Display em `$$ ... $$` em linha própria; inline em `$...$`. Evite `\begin{align}`
(não renderiza bem no HTML do Quarto); prefira `\begin{aligned}` dentro de `$$`.

Ao editar um trecho, **padronize a notação dele**. Não faça varredura de notação em
capítulos que você não foi pedido para mexer.

## Callouts

Definições, resultados, algoritmos e avisos vão em callouts do Quarto, com título
via atributo `title=` (não use um `##` dentro do bloco: isso criaria uma seção no
sumário). Os cinco tipos em uso:

````markdown
::: {.callout-note title="Definição: inversa da CDF"}
Seja $F$ a f.d.a. de $X$. A inversa de $F$ é ...
:::

::: {.callout-important title="Proposição"}
Se $U \sim \text{Unif}(0,1)$, então $F^{-1}(U)$ tem distribuição $F$.
:::

::: {.callout-note collapse="true" title="Demonstração"}
...
:::

::: {.callout-tip title="Pseudo-algoritmo"}
1. Gere $U \sim \text{Unif}(0,1)$.
2. Calcule $X = F^{-1}(U)$.
:::

::: {.callout-warning title="Atenção"}
Em Python, `^` não é exponenciação — é o XOR bit a bit.
:::
````

- **Definição** → `callout-note`; **teorema/proposição/lema** → `callout-important`;
  **demonstração** → `callout-note` com `collapse="true"` (o aluno abre se quiser);
  **pseudo-algoritmo** → `callout-tip`; **armadilha/erro comum** → `callout-warning`.
- Não aninhe callout dentro de `panel-tabset` nem o contrário — o Quarto não
  renderiza bem essa combinação.
- Não coloque um exemplo inteiro (texto + código) dentro de callout: eles servem
  para blocos curtos e destacáveis, não para estruturar o capítulo.
- Callouts substituem o padrão antigo de **negrito** (`**Definição:**`,
  `**Teorema:**`, `**Prova:**`, `**Pseudo-Algoritmo:**`). Ao editar uma seção que
  ainda usa negrito para isso, converta.

## Exercícios

Ao final de cada capítulo, sob `## Exercícios`, com este marcador exato:

```markdown
<span style="color:#2C92B2;">**Exercício 1**</span>. Enunciado...
```

O ponto final fica **fora** do `<span>`. Itens dentro de um exercício usam `(a)`,
`(b)`, `(c)` ou marcadores.

### Exercícios difíceis: `(Desafio)`

Exercícios **substancialmente mais difíceis** que os demais do capítulo são
marcados com `(Desafio)` logo após o marcador, e ficam **sempre no fim** da lista
de exercícios do capítulo:

```markdown
<span style="color:#2C92B2;">**Exercício 8**</span>. (Desafio) Enunciado...
```

- "Substancialmente mais difícil" quer dizer *qualitativamente* diferente do
  resto: exige uma demonstração que o capítulo não fez, uma otimização analítica,
  ou um argumento em aberto. Um exercício apenas mais longo, ou com mais itens,
  **não** é desafio.
- Se o capítulo tiver mais de um desafio, todos ficam ao final, depois dos
  exercícios comuns.
- Ao promover um exercício a desafio, mova-o para o fim e **renumere** os que
  vinham depois dele — conferindo se algum texto do livro cita esse exercício
  pelo número.
- Um **item** difícil dentro de um exercício comum também pode levar `(Desafio)`
  (ex.: `(d) (Desafio) ...`). Mas se o exercício inteiro virar desafio, remova as
  marcações internas: elas ficam redundantes.

Os exercícios não têm solução publicada — não adicione resoluções sem pedido explícito.

## Escopo das edições

O texto tem voz própria, de quatro autores, e a maior parte dele já está boa. O
trabalho aqui é de **revisão**, não de reescrita.

Faça sem perguntar:

- corrigir erros de português, digitação e concordância;
- corrigir erros matemáticos e de código (inclusive divergências R↔Python);
- corrigir numeração quebrada (ex.: dois "Exemplo 4" no mesmo capítulo);
- deixar explícito um passo que está implícito demais para o público-alvo.

Pergunte antes:

- reordenar ou reescrever seções inteiras;
- adicionar ou remover exemplos e exercícios;
- mudar o estilo visual além dos callouts já padronizados (temas de gráfico, cores);
- mexer em `_quarto.yml`, `pyproject.toml` ou na lista de capítulos.

Ao alterar um capítulo, mantenha o registro do que mudou no resumo da resposta:
o que era erro factual, o que era clareza, o que era estilo. Isso importa mais que
o diff, porque os coautores precisam revisar.

Nunca "modernize" o estilo por conta própria — trocar `for` por vetorização, trocar
`np.random.seed` por `default_rng`, reescrever laços didáticos como one-liners. Se
achar que vale a pena, proponha.
