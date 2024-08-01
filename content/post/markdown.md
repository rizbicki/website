---
title: "Sugestões para relatórios de meus alunos"
author: "Rafael Izbicki"
date: '2023-01-13'
output: html_document
tags:
- Portuguese
- Alunos
categories:
- Blog Post
editor_options: 
  chunk_output_type: console
---

### Guia de Boas Práticas para Escrita de Relatórios com R Markdown

#### Introdução
Aqui você encontrará orientações essenciais para criar relatórios bem formatados e claros utilizando R Markdown quando. A seguir, apresentamos uma lista de pontos que devem ser observados ao preparar seu relatório para uma disciplina.

#### Estrutura do Documento

1. **Nome e Título**
   - **Nome:** Coloque seu nome completo no início do documento.
   - **Título:** Escolha um título claro e descritivo que reflita o conteúdo do seu relatório.

```markdown
   ---
   title: "Título do Relatório"
   author: "Seu Nome Completo"
   date: "`r format(Sys.Date(), '%d/%m/%Y')`"
   output: html_document
   ---
```

2. **Cabeçalhos e Subcabeçalhos**
   - Utilize cabeçalhos (`#`, `##`, `###`, etc.) para organizar o conteúdo de forma hierárquica e facilitar a leitura.

#### Formatação de Código

3. **Código no Texto**
   - Certifique-se de que todo o código cabe na largura da página sem necessidade de rolagem horizontal.

 

4. **Não Imprimir Warnings**
   - Suprima mensagens de aviso (`warnings`) que não são relevantes para a interpretação dos resultados.

```markdown
   ```{r, warning=FALSE}
   # Código sem warnings
   summary(mtcars)
    ```
```

5. **Evitar Longas Tabelas**
   - Não imprima tabelas extensas diretamente no relatório. Utilize funções como `head()` ou `kableExtra` para mostrar apenas partes relevantes ou resumos das tabelas.

```markdown
   ```{r}
   library(knitr)
   library(kableExtra)
   # Exemplo de tabela compacta
   kable(head(mtcars), format = "html") %>%
     kable_styling(bootstrap_options = c("striped", "hover"))
    ```
```

#### Boas Práticas de Formatação

6. **Comentário de Código**
   - Comente seu código de forma clara para explicar a finalidade de cada bloco. Isso ajuda na compreensão e manutenção do código.

```markdown
   ```{r, echo=TRUE}
   # Calcula o resumo estatístico do dataset mtcars
   summary(mtcars)
    ```
```

7. **Gráficos e Visualizações**
   - Ao inserir gráficos, certifique-se de que eles são legíveis e relevantes. Ajuste os tamanhos conforme necessário.

```markdown
   ```{r, fig.width=6, fig.height=4}
   # Gráfico de dispersão
   plot(mtcars$wt, mtcars$mpg, main="Peso vs. MPG",
        xlab="Peso do Carro", ylab="MPG")
    ```
```

8. **Referências e Bibliografia**
   - Inclua todas as referências de forma adequada utilizando o formato de citação escolhido. Você pode usar o `rmarkdown` para gerenciar a bibliografia.

```markdown
   ---
   bibliography: references.bib
   ---

   # Citando uma referência
   De acordo com @autor2020, ...
```




#### Outros

9. **Revisão**
   - Revise seu relatório antes de enviar. Verifique ortografia, gramática e se todas as seções estão bem organizadas e coerentes.

10. **Versão PDF**
    - Se for necessário enviar o relatório em formato PDF, utilize a opção de renderização apropriada no R Markdown.


11. **Índice**
    - Inclua um índice se o relatório for extenso. Isso ajuda na navegação pelo documento.

```markdown
    output:
      html_document:
        toc: true
        toc_depth: 3
```

12. **Estilo de Texto**
    - Use itálico, negrito e listas para destacar pontos importantes.

```markdown
    - **Importante:** Este é um ponto crucial.
    - *Nota:* Este é um detalhe adicional.
```

13. **Incorporar Imagens e Links**
    - Adicione imagens e links para enriquecer o conteúdo do relatório.

```markdown
    ![Título da Imagem](caminho/para/imagem.png)
    
    [Link para um recurso útil](http://www.exemplo.com)
```

14. **Interatividade**
    - Para documentos HTML, considere incluir widgets interativos com pacotes como `shiny` ou `plotly`.

```markdown
    ```{r, echo=FALSE}
    library(plotly)
    plot_ly(data = mtcars, x = ~wt, y = ~mpg, type = 'scatter', mode = 'markers')
     ```
```

 
15. **Cache de Resultados**
    - Utilize o cache para evitar a reexecução de códigos demorados sempre que o documento for renderizado.

```markdown
    ```{r, cache=TRUE}
    # Código que demora para ser executado
    long_computation <- lm(mpg ~ wt, data = mtcars)
    summary(long_computation)
     ```
```


Seguindo essas diretrizes, você conseguirá criar relatórios bem organizados e com uma apresentação profissional, facilitando a leitura e a compreensão dos resultados apresentados.