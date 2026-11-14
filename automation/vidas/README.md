# ViDAS no domínio do site

O painel é servido em <https://rafaelizbicki.com/dashboard/vidas/>. O código e o treino ficam em [`rizbicki/vidas-dashboard`](https://github.com/rizbicki/vidas-dashboard).

1. Às segundas, 08h17 de São Paulo, o workflow do ViDAS baixa a base mais recente, treina os quatro modelos e valida o painel completo.
2. O ViDAS publica uma release com `vidas-dashboard.zip` e `build-info.json`, contendo a tag, a data da base, o commit do treino e o checksum SHA-256.
3. `sync-vidas.yml` verifica novas releases de hora em hora, aos 43 minutos. Quando encontra uma nova, baixa e verifica o pacote antes de commitar apenas `automation/vidas/release.json`.
4. O Netlify detecta o commit, baixa o pacote fixado nesse manifesto, confere seu checksum, extrai os arquivos para `static/dashboard/vidas/` e executa o Hugo. O dashboard é publicado junto com o site, no mesmo domínio.

Não há tokens de escrita entre os dois repositórios. Os arquivos grandes do painel ficam nas releases; os dados brutos ficam no cache do ViDAS. O site versiona somente o manifesto pequeno. Um pacote inválido faz o build falhar e mantém o deploy anterior no ar.

O repositório `vidas-dashboard` é privado; o painel publicado continua público. Para baixar as releases, crie um token fine-grained limitado a esse repositório, com **Contents: Read-only**, e salve-o como `VIDAS_READ_TOKEN` nos **Settings → Secrets and variables → Actions** do repositório `website` e nas **Project configuration → Environment variables** do Netlify (escopo **Builds**, contexto **Production**). Renove o token nesses dois locais antes de expirar. O script usa a API autenticada do GitHub e não repassa a credencial nos redirecionamentos para os arquivos. O token nunca deve ser versionado nem incluído nos arquivos publicados.

Builds de outros contextos, como Deploy Previews, também precisam dessa variável para baixar o painel; habilite-a apenas em contextos confiáveis. Sem acesso, o build falha com uma mensagem de configuração, preservando o deploy publicado.

Antes da primeira release, o endereço definitivo mostra uma página de preparação que se atualiza a cada cinco minutos. A primeira sincronização bem-sucedida substitui essa página pelo painel completo.

Para sincronizar imediatamente, execute **Actions → Sync published ViDAS dashboard → Run workflow** neste repositório. Para antecipar o treino, execute **Build data and publish dashboard bundle** no repositório do ViDAS.

Para reproduzir o build localmente, com Python 3.11+ e Hugo 0.110.0:

Disponibilize `VIDAS_READ_TOKEN` no ambiente local antes de executar os comandos abaixo.

```sh
python automation/vidas/sync.py
hugo
```

Para selecionar manualmente uma release nova, execute `python automation/vidas/sync.py --update-manifest`, confira o pacote com o comando acima e commite o manifesto. Os arquivos gerados em `static/dashboard/vidas/` são ignorados pelo Git.
