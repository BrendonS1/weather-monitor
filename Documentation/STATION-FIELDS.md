# Station feed fields for month and year statistics

The weather page's **Highs and lows** table prefers the station's own statistics,
because the Meteobridge keeps them from 1 January (or the 1st of the month). That
covers the whole year, while our database only starts in February 2026.

`NEmetData.txt` currently includes `tempym` (year max temperature), `windmm`
(month max wind) and `rainms` (month rain). To fill the rest of the table from the
station, add these lines to the NEmetData.txt template on the Meteobridge, inside
the JSON object next to the existing `tempym` line:

```
"tempmmin":"[th0temp-mmin:--]",
"tempymin":"[th0temp-ymin:--]",
"windym":"[wind0wind-ymax:--]",
"rainys":"[rain0total-yearsum:--]",
"pressmm":"[thb0seapress-mmax:--]",
"pressmmin":"[thb0seapress-mmin:--]",
"pressym":"[thb0seapress-ymax:--]",
"pressymin":"[thb0seapress-ymin:--]",
```

- **Units:** use the same unit converters as the existing lines. If `winddm` and
  `windmm` use a knots converter (for example `[wind0wind-mmax=kts:--]`), add the
  same `=kts` to `windym`. Do the same for temperature, rain and pressure if their
  existing lines use converters.
- **Missing values:** the `:--` suffix makes a missing value show as `--`. The page
  treats that as missing and falls back to the database for that cell.
- **Field names:** the page reads exactly these names, so keep them as written.

| Field | Meaning | Table cell |
|---|---|---|
| `tempmmin` | Lowest temperature this month | Min temp, Month |
| `tempymin` | Lowest temperature this year | Min temp, Year |
| `windym` | Highest wind this year | Max wind, Year |
| `rainys` | Rain so far this year | Rain, Year |
| `pressmm` / `pressmmin` | Highest / lowest MSL pressure this month | Pressure, Month |
| `pressym` / `pressymin` | Highest / lowest MSL pressure this year | Pressure, Year |

Template syntax reference: <https://meteobridge.com/wiki/index.php/Templates/en>
