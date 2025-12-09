let SessionLoad = 1
if &cp | set nocp | endif
let s:cpo_save=&cpo
set cpo&vim
imap <Nul> <C-Space>
inoremap <expr> <Up> pumvisible() ? "\" : "\<Up>"
inoremap <expr> <S-Tab> pumvisible() ? "\" : "\<S-Tab>"
inoremap <expr> <Down> pumvisible() ? "\" : "\<Down>"
inoremap <C-Tab> <C-Tab>
imap <C-F8> <C-F8>
imap <S-F8> <S-F8>
imap <F8> <F8>
imap <M-F8> <M-F8>
map! <S-Insert> *
vnoremap <silent> <NL> :m'>+1gv=gv
nnoremap <silent> <NL> :m+==
vnoremap <silent>  :m'<-2gv=gv
nnoremap <silent>  :m-2==
nmap  :let @*=expand("%")
vmap  gc
nmap  gcc
nnoremap <silent>  :up
nmap  "*P
tnoremap  "*
vmap  "*d
imap ® ddi
imap ä yypgi
cnoremap ì <S-Right>
cnoremap è <S-Left>
map Q gq
xmap S <Plug>VSurround
nnoremap \d :YcmShowDetailedDiagnostic
vnoremap \v 
nnoremap \v 
nnoremap <silent> \be :BufExplorer
nnoremap <silent> \bt :ToggleBufExplorer
nmap \\ :@:
nmap <silent> \r :simalt ~r
nmap <silent> \x :simalt ~x
nmap <silent> \n :simalt ~n
nmap cS <Plug>CSurround
nmap cs <Plug>Csurround
nmap ds <Plug>Dsurround
xmap gS <Plug>VgSurround
nmap gcu <Plug>Commentary<Plug>Commentary
nmap gcc <Plug>CommentaryLine
omap gc <Plug>Commentary
nmap gc <Plug>Commentary
xmap gc <Plug>Commentary
vmap gx <Plug>NetrwBrowseXVis
nmap gx <Plug>NetrwBrowseX
xmap gr <Plug>ReplaceWithRegisterVisual
nmap grr <Plug>ReplaceWithRegisterLine
nmap gr <Plug>ReplaceWithRegisterOperator
nmap ySS <Plug>YSsurround
nmap ySs <Plug>YSsurround
nmap yss <Plug>Yssurround
nmap yS <Plug>YSurround
nmap ys <Plug>Ysurround
nnoremap <silent> <Plug>SurroundRepeat .
nmap <silent> <Plug>CommentaryUndo :echoerr "Change your <Plug>CommentaryUndo map to <Plug>Commentary<Plug>Commentary"
vnoremap <silent> <Plug>NetrwBrowseXVis :call netrw#BrowseXVis()
nnoremap <silent> <Plug>NetrwBrowseX :call netrw#BrowseX(expand((exists("g:netrw_gx")? g:netrw_gx : '<cfile>')),netrw#CheckIfRemote())
nnoremap <silent> <Plug>ReplaceWithRegisterVisual :call setline('.', getline('.'))|execute 'silent! call repeat#setreg("\<Plug>ReplaceWithRegisterVisual", v:register)'|call ReplaceWithRegister#SetRegister()|if ReplaceWithRegister#IsExprReg()|    let g:ReplaceWithRegister_expr = getreg('=')|endif|execute 'normal!' ReplaceWithRegister#VisualMode()|call ReplaceWithRegister#Operator('visual', "\<Plug>ReplaceWithRegisterVisual")
vnoremap <silent> <Plug>ReplaceWithRegisterVisual :call setline('.', getline('.'))|execute 'silent! call repeat#setreg("\<Plug>ReplaceWithRegisterVisual", v:register)'|call ReplaceWithRegister#SetRegister()|if ReplaceWithRegister#IsExprReg()|    let g:ReplaceWithRegister_expr = getreg('=')|endif|call ReplaceWithRegister#Operator('visual', "\<Plug>ReplaceWithRegisterVisual")
nnoremap <silent> <Plug>ReplaceWithRegisterLine :call setline('.', getline('.'))|execute 'silent! call repeat#setreg("\<Plug>ReplaceWithRegisterLine", v:register)'|call ReplaceWithRegister#SetRegister()|if ReplaceWithRegister#IsExprReg()|    let g:ReplaceWithRegister_expr = getreg('=')|endif|execute 'normal! V' . v:count1 . "_\<Esc>"|call ReplaceWithRegister#Operator('visual', "\<Plug>ReplaceWithRegisterLine")
nnoremap <silent> <Plug>ReplaceWithRegisterExpressionSpecial :let g:ReplaceWithRegister_expr = getreg('=')|execute 'normal!' v:count1 . '.'
nnoremap <expr> <Plug>ReplaceWithRegisterOperator ReplaceWithRegister#OperatorExpression()
nmap <M-Right> l
nmap <M-Up> k
nmap <M-Down> j
nmap <M-Left> h
nnoremap <C-Tab> 
nmap <C-F8> p
nmap <S-F8> W
nmap <F8> w
nmap <M-F8> v
nnoremap <silent> <S-F9> :Rexplore
nnoremap <silent> <F9> :let @#=expand("%")|enew|Explore
tnoremap <M-Right> l
tnoremap <M-Up> k
tnoremap <M-Down> j
tnoremap <M-Left> h
tnoremap <C-F8> p
tnoremap <S-F8> W
tmap <silent> <S-F7> <F2>exec "res" b:lastwinheight
tmap <silent> <F7> <F2>let b:lastwinheight=winheight(0)|hide
tnoremap <F2> :
tnoremap <F1> N
nnoremap <silent> <F7> :let @t=expand("%:p:h")|let @w=getbufvar("Console (".@t.")", "lastwinheight")|execute @w."sp|b Console (".@t.")"
nnoremap <silent> <C-F7> :let @t=expand("%:p:h")|term ++rows=20 ++close cmd.exe /k shstart -a:execute "file Console (".@t.")"i
nnoremap <silent> <M-F7> :let @t=expand("%:p:h")|term ++rows=20 ++close C:\Program Files\Git\bin\bash.exe:execute "file Console (".@t.")"i
nnoremap <silent> <F6> :ToggleBufExplorer
nnoremap <silent> <C-F4> :bot copen
nnoremap <silent> <S-F4> :set relativenumber!
nnoremap <silent> <F4> :nohls
nmap <F3> q/
nmap <F2> q:
vmap <C-Del> "*d
vmap <S-Del> "*d
vmap <C-Insert> "*y
vmap <S-Insert> "-d"*P
nmap <S-Insert> "*P
cnoremap  <Home>
imap S <Plug>ISurround
imap s <Plug>Isurround
cnoremap  <Left>
inoremap <expr> 	 pumvisible() ? "\" : "\	"
inoremap <silent> <NL> :m+==gi
cnoremap <NL> <Down>
inoremap <silent>  :m-2==gi
cnoremap  <Up>
cnoremap  <Right>
imap  gccgi
imap  
inoremap  u
map!  *
nnoremap ² :execute "b".@b
nnoremap ± :execute "b".@a
nmap <silent> ¬ :bp
nmap <silent> ® :bn
nmap Ð :let @*=expand("%:p")
nmap ð :let @*=expand("%:p:h")
noremap Æ zA
noremap æ za
nnoremap é o
nnoremap É O
vmap ä y:'>putgv
nmap ä yyP
nnoremap ì zL
nnoremap è zH
nnoremap ë 
nnoremap ê 
nnoremap ã :bp|sp|bn|bd
nnoremap ÷ c
nnoremap â :let @b=bufnr("%")
nnoremap á :let @a=bufnr("%")
nmap å Go
vnoremap ö 
nnoremap ö 
tmap ÷ <F7>
inoremap jj 
let &cpo=s:cpo_save
unlet s:cpo_save
set autochdir
set background=dark
set backspace=indent,eol,start
set clipboard=unnamed
set completefunc=youcompleteme#CompleteFunc
set completeopt=preview,menuone
set display=truncate
set encoding=utf-8
set fileencodings=ucs-bom,utf-8,default,latin1
set fillchars=vert:|,fold:-,vert:\ 
set foldlevelstart=99
set grepprg=grep\ -n
set guifont=Consolas:h11
set guioptions=egrL
set helplang=En
set hidden
set history=200
set hlsearch
set ignorecase
set incsearch
set langnoremap
set nolangremap
set laststatus=2
set nrformats=bin,hex
set operatorfunc=<SNR>36_go
set pyxversion=3
set ruler
set runtimepath=~/vimfiles,~\\vimfiles\\bundle\\Vundle.vim,~\\vimfiles\\bundle\\YouCompleteMe,~\\vimfiles\\pack\\tpope\\start\\surround,~\\vimfiles\\pack\\tpope\\start\\commentary,C:\\Program\ Files\ (x86)\\Vim/vimfiles,C:\\Program\ Files\ (x86)\\Vim\\vim81,C:\\Program\ Files\ (x86)\\Vim/vimfiles/after,~/vimfiles/after,~/vimfiles/bundle/Vundle.vim,~\\AppData/vifm/vim,~\\vimfiles\\bundle\\Vundle.vim/after,~\\vimfiles\\bundle\\YouCompleteMe/after
set scrolloff=5
set shiftwidth=4
set smartcase
set splitbelow
set splitright
set statusline=[%n]\ %<%f\ %h%m%r%=%-14.(%l,%c%V%)\ %P
set noswapfile
set tabstop=4
set ttimeout
set ttimeoutlen=100
set wildmenu
set winaltkeys=no
set window=52
let s:so_save = &so | let s:siso_save = &siso | set so=0 siso=0
let v:this_session=expand("<sfile>:p")
silent only
cd m:\dev\webext\chrome\src
if expand('%') == '' && !&modified && line('$') <= 1 && getline(1) == ''
  let s:wipebuf = bufnr('%')
endif
set shortmess=aoO
badd +3032 m:\dev\webext\chrome\src\mplayer.js
badd +2538 m:\dev\webext\unified\src\mplayer.js
badd +763 m:\dev\webext\chrome\src\bg.js
badd +51 m:\dev\webext\chrome\src\utils.js
badd +57 m:\dev\webext\unified\src\utils.js
badd +1 m:\dev\webext\chrome\src\nm_connector.js
badd +3 m:\dev\webext\chrome\src\bg.html
badd +279 m:\dev\webext\chrome\src\panel.js
badd +63 m:\dev\webext\chrome\src\badge.js
badd +35 m:\dev\webext\chrome\src\content_scripts\si_listener.js
argglobal
silent! argdel *
$argadd content_scripts\si_listener.js
edit m:\dev\webext\chrome\src\nm_connector.js
set splitbelow splitright
wincmd _ | wincmd |
vsplit
1wincmd h
wincmd _ | wincmd |
split
1wincmd k
wincmd w
wincmd w
wincmd t
set winminheight=1 winheight=1 winminwidth=1 winwidth=1
exe '1resize ' . ((&lines * 30 + 26) / 53)
exe 'vert 1resize ' . ((&columns * 118 + 117) / 235)
exe '2resize ' . ((&lines * 20 + 26) / 53)
exe 'vert 2resize ' . ((&columns * 118 + 117) / 235)
exe 'vert 3resize ' . ((&columns * 116 + 117) / 235)
argglobal
setlocal keymap=
setlocal noarabic
setlocal autoindent
setlocal backupcopy=
setlocal balloonexpr=
setlocal nobinary
setlocal nobreakindent
setlocal breakindentopt=
setlocal bufhidden=
setlocal buflisted
setlocal buftype=
setlocal nocindent
setlocal cinkeys=0{,0},0),:,0#,!^F,o,O,e
setlocal cinoptions=
setlocal cinwords=if,else,while,do,for,switch
setlocal colorcolumn=
setlocal comments=sO:*\ -,mO:*\ \ ,exO:*/,s1:/*,mb:*,ex:*/,://
setlocal commentstring=//%s
setlocal complete=.,w,b,u,t,i
setlocal concealcursor=
setlocal conceallevel=0
setlocal completefunc=youcompleteme#CompleteFunc
setlocal nocopyindent
setlocal cryptmethod=
setlocal nocursorbind
setlocal nocursorcolumn
setlocal nocursorline
setlocal define=
setlocal dictionary=
setlocal nodiff
setlocal equalprg=
setlocal errorformat=
setlocal noexpandtab
if &filetype != 'javascript'
setlocal filetype=javascript
endif
setlocal fixendofline
setlocal foldcolumn=0
setlocal foldenable
setlocal foldexpr=0
setlocal foldignore=#
setlocal foldlevel=99
setlocal foldmarker={{{,}}}
set foldmethod=indent
setlocal foldmethod=indent
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldtext=foldtext()
setlocal formatexpr=
setlocal formatoptions=ql
setlocal formatlistpat=^\\s*\\d\\+[\\]:.)}\\t\ ]\\s*
setlocal formatprg=
setlocal grepprg=
setlocal iminsert=0
setlocal imsearch=-1
setlocal include=
setlocal includeexpr=
setlocal indentexpr=GetJavascriptIndent()
setlocal indentkeys=0{,0},:,0#,!^F,o,O,e,0],0)
setlocal noinfercase
setlocal iskeyword=@,48-57,_,192-255
setlocal keywordprg=
setlocal nolinebreak
setlocal nolisp
setlocal lispwords=
setlocal nolist
setlocal makeencoding=
setlocal makeprg=
setlocal matchpairs=(:),{:},[:]
setlocal modeline
setlocal modifiable
setlocal nrformats=bin,hex
set number
setlocal number
setlocal numberwidth=4
setlocal omnifunc=javascriptcomplete#CompleteJS
setlocal path=
setlocal nopreserveindent
setlocal nopreviewwindow
setlocal quoteescape=\\
setlocal noreadonly
set relativenumber
setlocal relativenumber
setlocal norightleft
setlocal rightleftcmd=search
setlocal noscrollbind
setlocal shiftwidth=4
setlocal noshortname
setlocal signcolumn=auto
setlocal nosmartindent
setlocal softtabstop=0
setlocal nospell
setlocal spellcapcheck=[.?!]\\_[\\])'\"\	\ ]\\+
setlocal spellfile=
setlocal spelllang=en
setlocal statusline=
setlocal suffixesadd=
setlocal noswapfile
setlocal synmaxcol=3000
if &syntax != 'javascript'
setlocal syntax=javascript
endif
setlocal tabstop=4
setlocal tagcase=
setlocal tags=
setlocal termwinkey=
setlocal termwinscroll=10000
setlocal termwinsize=
setlocal textwidth=0
setlocal thesaurus=
setlocal noundofile
setlocal undolevels=-123456
setlocal nowinfixheight
setlocal nowinfixwidth
set nowrap
setlocal nowrap
setlocal wrapmargin=0
8
normal! zo
9
normal! zo
18
normal! zo
39
normal! zo
41
normal! zo
42
normal! zo
44
normal! zo
205
normal! zo
227
normal! zo
232
normal! zo
234
normal! zo
235
normal! zo
241
normal! zo
241
normal! zo
241
normal! zo
241
normal! zo
241
normal! zo
282
normal! zo
286
normal! zo
289
normal! zo
307
normal! zo
318
normal! zo
let s:l = 1 - ((0 * winheight(0) + 15) / 30)
if s:l < 1 | let s:l = 1 | endif
exe s:l
normal! zt
1
normal! 0
wincmd w
argglobal
terminal ++curwin ++cols=118 ++rows=20 C:\Program Files\Git\bin\bash.exe
setlocal keymap=
setlocal noarabic
setlocal noautoindent
setlocal backupcopy=
setlocal balloonexpr=
setlocal nobinary
setlocal nobreakindent
setlocal breakindentopt=
setlocal bufhidden=
setlocal buflisted
setlocal buftype=terminal
setlocal nocindent
setlocal cinkeys=0{,0},0),:,0#,!^F,o,O,e
setlocal cinoptions=
setlocal cinwords=if,else,while,do,for,switch
setlocal colorcolumn=
setlocal comments=s1:/*,mb:*,ex:*/,://,b:#,:%,:XCOMM,n:>,fb:-
setlocal commentstring=/*%s*/
setlocal complete=.,w,b,u,t,i
setlocal concealcursor=
setlocal conceallevel=0
setlocal completefunc=youcompleteme#CompleteFunc
setlocal nocopyindent
setlocal cryptmethod=
setlocal nocursorbind
setlocal nocursorcolumn
setlocal nocursorline
setlocal define=
setlocal dictionary=
setlocal nodiff
setlocal equalprg=
setlocal errorformat=
setlocal noexpandtab
if &filetype != ''
setlocal filetype=
endif
setlocal fixendofline
setlocal foldcolumn=0
setlocal foldenable
setlocal foldexpr=0
setlocal foldignore=#
setlocal foldlevel=99
setlocal foldmarker={{{,}}}
set foldmethod=indent
setlocal foldmethod=indent
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldtext=foldtext()
setlocal formatexpr=
setlocal formatoptions=tcq
setlocal formatlistpat=^\\s*\\d\\+[\\]:.)}\\t\ ]\\s*
setlocal formatprg=
setlocal grepprg=
setlocal iminsert=0
setlocal imsearch=-1
setlocal include=
setlocal includeexpr=
setlocal indentexpr=
setlocal indentkeys=0{,0},:,0#,!^F,o,O,e
setlocal noinfercase
setlocal iskeyword=@,48-57,_,192-255
setlocal keywordprg=
setlocal nolinebreak
setlocal nolisp
setlocal lispwords=
setlocal nolist
setlocal makeencoding=
setlocal makeprg=
setlocal matchpairs=(:),{:},[:]
setlocal modeline
setlocal nomodifiable
setlocal nrformats=bin,hex
set number
setlocal number
setlocal numberwidth=4
setlocal omnifunc=
setlocal path=
setlocal nopreserveindent
setlocal nopreviewwindow
setlocal quoteescape=\\
setlocal noreadonly
set relativenumber
setlocal relativenumber
setlocal norightleft
setlocal rightleftcmd=search
setlocal noscrollbind
setlocal shiftwidth=4
setlocal noshortname
setlocal signcolumn=auto
setlocal nosmartindent
setlocal softtabstop=0
setlocal nospell
setlocal spellcapcheck=[.?!]\\_[\\])'\"\	\ ]\\+
setlocal spellfile=
setlocal spelllang=en
setlocal statusline=
setlocal suffixesadd=
setlocal noswapfile
setlocal synmaxcol=3000
if &syntax != ''
setlocal syntax=
endif
setlocal tabstop=4
setlocal tagcase=
setlocal tags=
setlocal termwinkey=
setlocal termwinscroll=10000
setlocal termwinsize=
setlocal textwidth=0
setlocal thesaurus=
setlocal noundofile
setlocal undolevels=-123456
setlocal nowinfixheight
setlocal nowinfixwidth
set nowrap
setlocal nowrap
setlocal wrapmargin=0
let s:l = 385 - ((9 * winheight(0) + 10) / 20)
if s:l < 1 | let s:l = 1 | endif
exe s:l
normal! zt
385
normal! 0
wincmd w
argglobal
if bufexists('m:\dev\webext\chrome\src\bg.js') | buffer m:\dev\webext\chrome\src\bg.js | else | edit m:\dev\webext\chrome\src\bg.js | endif
setlocal keymap=
setlocal noarabic
setlocal autoindent
setlocal backupcopy=
setlocal balloonexpr=
setlocal nobinary
setlocal nobreakindent
setlocal breakindentopt=
setlocal bufhidden=
setlocal buflisted
setlocal buftype=
setlocal nocindent
setlocal cinkeys=0{,0},0),:,0#,!^F,o,O,e
setlocal cinoptions=
setlocal cinwords=if,else,while,do,for,switch
setlocal colorcolumn=
setlocal comments=sO:*\ -,mO:*\ \ ,exO:*/,s1:/*,mb:*,ex:*/,://
setlocal commentstring=//%s
setlocal complete=.,w,b,u,t,i
setlocal concealcursor=
setlocal conceallevel=0
setlocal completefunc=youcompleteme#CompleteFunc
setlocal nocopyindent
setlocal cryptmethod=
setlocal nocursorbind
setlocal nocursorcolumn
setlocal nocursorline
setlocal define=
setlocal dictionary=
setlocal nodiff
setlocal equalprg=
setlocal errorformat=
setlocal noexpandtab
if &filetype != 'javascript'
setlocal filetype=javascript
endif
setlocal fixendofline
setlocal foldcolumn=0
setlocal foldenable
setlocal foldexpr=0
setlocal foldignore=#
setlocal foldlevel=99
setlocal foldmarker={{{,}}}
set foldmethod=indent
setlocal foldmethod=indent
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldtext=foldtext()
setlocal formatexpr=
setlocal formatoptions=ql
setlocal formatlistpat=^\\s*\\d\\+[\\]:.)}\\t\ ]\\s*
setlocal formatprg=
setlocal grepprg=
setlocal iminsert=0
setlocal imsearch=-1
setlocal include=
setlocal includeexpr=
setlocal indentexpr=GetJavascriptIndent()
setlocal indentkeys=0{,0},:,0#,!^F,o,O,e,0],0)
setlocal noinfercase
setlocal iskeyword=@,48-57,_,192-255
setlocal keywordprg=
setlocal nolinebreak
setlocal nolisp
setlocal lispwords=
setlocal nolist
setlocal makeencoding=
setlocal makeprg=
setlocal matchpairs=(:),{:},[:]
setlocal modeline
setlocal modifiable
setlocal nrformats=bin,hex
set number
setlocal number
setlocal numberwidth=4
setlocal omnifunc=javascriptcomplete#CompleteJS
setlocal path=
setlocal nopreserveindent
setlocal nopreviewwindow
setlocal quoteescape=\\
setlocal noreadonly
set relativenumber
setlocal relativenumber
setlocal norightleft
setlocal rightleftcmd=search
setlocal noscrollbind
setlocal shiftwidth=4
setlocal noshortname
setlocal signcolumn=auto
setlocal nosmartindent
setlocal softtabstop=0
setlocal nospell
setlocal spellcapcheck=[.?!]\\_[\\])'\"\	\ ]\\+
setlocal spellfile=
setlocal spelllang=en
setlocal statusline=
setlocal suffixesadd=
setlocal noswapfile
setlocal synmaxcol=3000
if &syntax != 'javascript'
setlocal syntax=javascript
endif
setlocal tabstop=4
setlocal tagcase=
setlocal tags=
setlocal termwinkey=
setlocal termwinscroll=10000
setlocal termwinsize=
setlocal textwidth=0
setlocal thesaurus=
setlocal noundofile
setlocal undolevels=-123456
setlocal nowinfixheight
setlocal nowinfixwidth
set nowrap
setlocal nowrap
setlocal wrapmargin=0
292
normal! zo
354
normal! zo
369
normal! zo
687
normal! zo
773
normal! zo
774
normal! zo
776
normal! zo
779
normal! zo
let s:l = 763 - ((10 * winheight(0) + 25) / 51)
if s:l < 1 | let s:l = 1 | endif
exe s:l
normal! zt
763
normal! 05|
wincmd w
exe '1resize ' . ((&lines * 30 + 26) / 53)
exe 'vert 1resize ' . ((&columns * 118 + 117) / 235)
exe '2resize ' . ((&lines * 20 + 26) / 53)
exe 'vert 2resize ' . ((&columns * 118 + 117) / 235)
exe 'vert 3resize ' . ((&columns * 116 + 117) / 235)
tabnext 1
if exists('s:wipebuf') && s:wipebuf != bufnr('%')
  silent exe 'bwipe ' . s:wipebuf
endif
unlet! s:wipebuf
set winheight=1 winwidth=20 shortmess=filnxtToO
set winminheight=1 winminwidth=1
let s:sx = expand("<sfile>:p:r")."x.vim"
if file_readable(s:sx)
  exe "source " . fnameescape(s:sx)
endif
let &so = s:so_save | let &siso = s:siso_save
doautoall SessionLoadPost
unlet SessionLoad
" vim: set ft=vim :
