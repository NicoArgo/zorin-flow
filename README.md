# Zorin Flow

As ideias do [POP Flow](https://github.com/NicoArgo/POP-Flow-Suite) — feitas para
o COSMIC — trazidas para o **Zorin OS 18 (GNOME 46, X11)**.

O POP Flow são forks em Rust dos componentes do COSMIC. Aqui nada é fork: tudo
é extensão do GNOME Shell, extensão do Nautilus e hook de shell, instalado na
sua home. **Sem sudo, sem trocar binário do sistema** — e por isso também sem o
auto-reapply via APT: update do sistema não desfaz nada.

## O que vem

| Peça | Equivalente no POP Flow | Onde |
|---|---|---|
| **Regras por pasta** (nome + cor), fonte única | `dir_rules` do cosmic-term | `lib/zflow_rules.py`, `bin/zflow-rule` |
| **Terminal na cor da pasta**: título da aba = nome da regra, cursor na cor, `● Nome` colorido no prompt; muda ao vivo no `cd` | cosmic-term T2 | `shell/zflow.bash` |
| **Pastas na cor da regra** no Arquivos e na área de trabalho, **Regra da pasta…** e **Copiar caminho** no botão direito | cosmic-files | `nautilus/zorin_flow.py` |
| **Contorno colorido** em volta da janela do terminal, na cor da pasta (mais fraco sem foco) | — (novo) | `borders.js` |
| **Fechar pelo Alt+Tab**: X na miniatura selecionada/sob o mouse, clique do meio fecha | X do Alt+Tab do cosmic-launcher | `alttab.js` |
| **Cantos inferiores → área de trabalho**: clicar na quina esquerda ou encostar o mouse na direita mostra a área de trabalho daquela tela; de novo, devolve | triângulo do canto (cosmic-applets) | `corner.js`, `desktop.js` |
| **Applet de terminais** `[>_] ● ● ●`: uma bolinha por janela, na cor da pasta, posição fixa, clique traz a janela | cosmic-applet-terminals | `terminals.js` |
| **Imagens / Downloads / Mostrar área de trabalho** no painel | botões do cosmic-applets | `places.js` |
| **Modo vampiro**: o PC só dorme quando você manda (1 h, 3 h, até desligar) | cosmic-applets | `vampire.js` |
| **Super+V**: histórico da área de transferência com filtro; escolher já cola | cosmic-clipboard-history | `clipboard.js` |
| **Destaque segue o papel de parede** (acento do Zorin mais próximo) | cosmic-wallsync | `wallsync.js`, `bin/zflow-wallsync` |

Ficaram de fora: gestos de três dedos (o Zorin já tem o Touchégg), "Abrir no
terminal" (o Arquivos já tem), Super+D (já existe) e a grade de miniaturas do Alt+Tab (o alternador de
janelas do GNOME já mostra prévias).

## Instalar / desinstalar

```bash
git clone https://github.com/NicoArgo/zorin-flow.git ~/zorin-flow
cd ~/zorin-flow
./install.sh        # depois: Alt+F2 → r, nautilus -q, terminal novo
./uninstall.sh      # --purge apaga também as regras
```

O instalador: liga os comandos em `~/.local/bin`, acrescenta um bloco marcado ao
`~/.bashrc` (backup em `~/.bashrc.zorin-flow.bak`), liga as extensões e tira o
**Super+V** da lista de notificações (o Super+M continua; o valor original fica
guardado e o `uninstall.sh` devolve).

## Regras por pasta

```bash
zflow-rule set . --name "Meu projeto" --color "#2ec4d6"   # pasta atual
zflow-rule set ~/proj --subdirs        # vale também para tudo dentro
zflow-rule get                         # regra que vale aqui
zflow-rule list
zflow-rule remove ~/proj
zflow-rule edit ~/proj                 # o mesmo diálogo do botão direito
```

Uma regra vale só para a própria pasta; cobrir a árvore é opt-in
(`--subdirs`). Vence a mais específica. As regras ficam em
`~/.config/zorin-flow/dir_rules.json` — se editar à mão, rode `zflow-rule sync`.

O ícone colorido é o próprio ícone de pasta do tema, recolorido, aplicado via
`metadata::custom-icon`. Uma pasta que já tinha ícone escolhido à mão não é
tocada.

## Configurações

`gnome-extensions prefs zorin-flow@nico.local` — liga/desliga cada peça.

## Licença

GPL-3.0 — veja [LICENSE](LICENSE). Inspirado no [POP Flow](https://github.com/NicoArgo/POP-Flow-Suite).
