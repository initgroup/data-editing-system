# M90003 initial column-type training profiles

`M90003_coltype_initial_samples.json` is the cold-start training pack used by
the M90003 **Create initial sample training data** action.

The repository contains only derived column statistics, labels, and source
attribution. It does not contain rows copied from the public datasets. Existing
user-confirmed labels are never overwritten; rerunning the action inserts only
missing profiles and labels.

The pack combines balanced boundary profiles with column profiles derived from
the following UCI Machine Learning Repository datasets (CC BY 4.0):

- Adult — DOI `10.24432/C5XW20`
- Bank Marketing — DOI `10.24432/C5K306`
- Bike Sharing — DOI `10.24432/C5W894`
- Wine Quality — DOI `10.24432/C56S3T`
- SMS Spam Collection — DOI `10.24432/C5CC84`
- Dry Bean — DOI `10.24432/C50S4B`
- Seoul Bike Sharing Demand — DOI `10.24432/C5F62R`
- Online Retail — DOI `10.24432/C5BW33`

Regenerate the JSON after downloading the official ZIP files to a temporary
cache outside the repository:

```powershell
.\venv\Scripts\python.exe scripts\build_m90003_coltype_seed.py `
  --cache-dir "$env:TEMP\init-coltype-uci" `
  --output database\seeds\M90003_coltype_initial_samples.json
```

Pass `--download` when the cache is empty. The builder uses a bounded reservoir
of 10,000 rows per dataset for entropy and numeric/text characteristics while
retaining full row, non-null, and distinct counts. Raw downloads remain in the
temporary cache and must not be committed.
