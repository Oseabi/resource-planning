# CV fonts

The generated PDF is drawn to match the CVs the team issues, which are set in
Century Gothic (regular, bold, italic) with Arial Bold for the headings and
labels. Those faces are Microsoft's and are not in this repository.

What is here are the closest free faces, and the renderer uses them by default:

- `gothic-*.otf`: TeX Gyre Adventor (GUST Font License), a free face in the
  same geometric family as Century Gothic, with near the same widths.
- `label-*.ttf`: Liberation Sans (SIL Open Font License), metrically
  compatible with Arial.

To print with the issued faces themselves, drop the font files into
`overrides/` under these names, as `.ttf` or `.otf`:

- `gothic-regular`, `gothic-bold`, `gothic-italic`
- `label-bold`

On a Windows machine with Office those are `C:\Windows\Fonts\GOTHIC.TTF`,
`GOTHICB.TTF`, `GOTHICI.TTF` and `arialbd.ttf`. Whether they may be copied to
the server is a licensing question for whoever holds the Office licence, which
is why the folder is empty and the free faces are the default.
