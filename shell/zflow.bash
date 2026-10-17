# Zorin Flow — identidade por pasta no terminal.
#
# Carregado pelo ~/.bashrc. A cada prompt, se a pasta (ou as regras) mudou:
#   - título da aba/janela = nome da regra (ou usuario@host: pasta, como antes)
#   - cursor na cor da regra (OSC 12) e um "● Nome" colorido no começo do prompt
#   - publica $XDG_RUNTIME_DIR/zorin-flow/terminals/<pid>.json para o applet
#     de terminais do painel pintar a bolinha desta janela
# As regras vêm de ~/.cache/zorin-flow/dir_rules.tsv (gerado pelo zflow-rule).
# Nada aqui faz fork no caminho comum: só bash puro e um teste de mtime.

[[ $- == *i* ]] || return 0
[[ -n ${_ZF_LOADED-} ]] && return 0
case "$TERM" in xterm*|vte*|*-256color) ;; *) return 0 ;; esac
_ZF_LOADED=1

_zf_rules="${XDG_CACHE_HOME:-$HOME/.cache}/zorin-flow/dir_rules.tsv"
_zf_dir="${XDG_RUNTIME_DIR:-/tmp/zorin-flow-$UID}/zorin-flow/terminals"
_zf_presence="$_zf_dir/$$.json"
_zf_stamp="$_zf_dir/.$$.stamp"
_zf_paths=() _zf_tree=() _zf_names=() _zf_accents=()
_zf_loaded=0 _zf_last_key="" _zf_badge=""

mkdir -p "$_zf_dir" 2>/dev/null

_zf_load() {
    _zf_paths=() _zf_tree=() _zf_names=() _zf_accents=()
    local p t n a
    if [[ -r $_zf_rules ]]; then
        while IFS=$'\t' read -r p t n a; do
            [[ -n $p ]] || continue
            _zf_paths+=("$p") _zf_tree+=("$t") _zf_names+=("$n") _zf_accents+=("$a")
        done < "$_zf_rules"
    fi
    : > "$_zf_stamp"
    _zf_loaded=1
}

# Índice da regra que vale para $PWD em _zf_hit (-1 = nenhuma).
_zf_match() {
    local i best=-1 bestlen=-1 p
    for i in "${!_zf_paths[@]}"; do
        p=${_zf_paths[i]}
        if [[ $PWD == "$p" ]]; then best=$i; break; fi
        if [[ ${_zf_tree[i]} == 1 && $PWD == "${p%/}/"* && ${#p} -gt $bestlen ]]; then
            best=$i bestlen=${#p}
        fi
    done
    _zf_hit=$best
}

_zf_json_str() {
    local s=${1//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\t'/\\t}
    s=${s//$'\n'/\\n}
    printf '"%s"' "$s"
}

_zf_prompt() {
    local rc=$?
    if (( ! _zf_loaded )) || [[ $_zf_rules -nt $_zf_stamp ]] \
        || { [[ ! -e $_zf_rules ]] && (( ${#_zf_paths[@]} )); }; then
        _zf_load
        _zf_last_key=""
    fi

    _zf_match
    local name="" accent="" title
    if (( _zf_hit >= 0 )); then
        name=${_zf_names[_zf_hit]}
        accent=${_zf_accents[_zf_hit]}
    fi
    if [[ -n $name ]]; then
        title=$name
    else
        title="${USER}@${HOSTNAME%%.*}: ${PWD/#$HOME/\~}"
    fi
    # O título vai sempre (programas como ssh/vim o trocam); o resto só quando muda.
    printf '\e]0;%s\a' "$title"

    local key="$PWD|$name|$accent"
    if [[ $key != "$_zf_last_key" ]]; then
        _zf_last_key=$key
        if [[ -n $accent ]]; then
            printf '\e]12;%s\a' "$accent"
            local r=$((16#${accent:1:2})) g=$((16#${accent:3:2})) b=$((16#${accent:5:2}))
            _zf_badge=$'\001\e[38;2;'"$r;$g;$b"$'m\002●'"${name:+ $name}"$'\001\e[0m\002 '
        else
            printf '\e]112\a'
            _zf_badge=""
        fi
        {
            printf '{"pid":%d,"title":%s,"name":%s,"accent":%s,"cwd":%s}\n' "$$" \
                "$(_zf_json_str "$title")" "$(_zf_json_str "$name")" \
                "$(_zf_json_str "$accent")" "$(_zf_json_str "$PWD")"
        } > "$_zf_presence.tmp" 2>/dev/null && command mv -f "$_zf_presence.tmp" "$_zf_presence" 2>/dev/null
    fi
    return $rc
}

_zf_exit() {
    command rm -f "$_zf_presence" "$_zf_presence.tmp" "$_zf_stamp" 2>/dev/null
    printf '\e]112\a'
}
trap _zf_exit EXIT

# O ~/.bashrc do Ubuntu põe o título (usuario@host: pasta) dentro do PS1, o que
# sobrescreveria o nosso a cada prompt. Tiramos esse pedaço; o _zf_prompt emite
# o mesmo título quando a pasta não tem regra.
if [[ $PS1 == '\[\e]0;'* ]]; then
    PS1=${PS1#*'\a\]'}
fi
PS1='${_zf_badge}'"$PS1"

# Por último, para o nosso título ganhar de quem mais mexer nele.
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_zf_prompt"
