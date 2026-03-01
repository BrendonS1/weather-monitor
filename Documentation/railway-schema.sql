-- Railway PostgreSQL Schema Migration
-- Extracted from Render database on 2026-02-16
-- Run this against the Railway PostgreSQL instance to recreate the schema

-- ============================================================
-- TABLES
-- ============================================================

-- Active weather data captures
CREATE TABLE IF NOT EXISTS weather_data (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT NOT NULL,
    raw_content JSONB NOT NULL,
    file_size INTEGER
);

-- Archive for records older than 90 days
CREATE TABLE IF NOT EXISTS weather_data_archive (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMP,
    content_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    file_size INTEGER,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parsed weather update data (populated by trigger)
CREATE TABLE IF NOT EXISTS weather_update (
    update_id BIGINT NOT NULL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL,
    content_hash TEXT,
    file_size INTEGER,
    station TEXT,
    timezone TEXT,
    lan_ip INET,
    device_local_ts TIMESTAMP,
    device_utc_ts TIMESTAMPTZ,
    wind_speed NUMERIC,
    wind_max_10 NUMERIC,
    wind_max_60 NUMERIC,
    wind_avg NUMERIC,
    wind_dir_deg INTEGER,
    wind_dir_deg_mag INTEGER,
    wind_dir_min_10 INTEGER,
    wind_dir_max_10 INTEGER,
    temp_out_c NUMERIC,
    hum_out_pct NUMERIC,
    dew_out_c NUMERIC,
    temp_in_c NUMERIC,
    hum_in_pct NUMERIC,
    dew_in_c NUMERIC,
    press_hpa NUMERIC,
    sea_press_hpa NUMERIC,
    rain_rate NUMERIC,
    rain_total NUMERIC,
    th0_lowbat BOOLEAN,
    thb0_lowbat BOOLEAN,
    wind_rwy_fav TEXT,
    wind_xwind NUMERIC,
    raw JSONB NOT NULL
);

-- Wind trend array data
CREATE TABLE IF NOT EXISTS weather_windtrend (
    update_id BIGINT NOT NULL,
    idx INTEGER NOT NULL,
    wind NUMERIC,
    PRIMARY KEY (update_id, idx)
);

-- Wind direction trend array data
CREATE TABLE IF NOT EXISTS weather_winddirtrend (
    update_id BIGINT NOT NULL,
    idx INTEGER NOT NULL,
    dir_deg NUMERIC,
    PRIMARY KEY (update_id, idx)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_captured_at ON weather_data(captured_at);
CREATE INDEX IF NOT EXISTS idx_content_hash ON weather_data(content_hash);
CREATE INDEX IF NOT EXISTS idx_archive_captured_at ON weather_data_archive(captured_at);

-- ============================================================
-- FUNCTION: tr_weather_data_parse
-- Parses raw_content JSONB from weather_data into weather_update,
-- weather_windtrend, and weather_winddirtrend tables.
-- Calculates magnetic heading, favoured runway, and crosswind.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tr_weather_data_parse()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  wdir_true int;
  wdir_mag  int;
  wavg      numeric;

  rwy       text;
  rwyhdg    int;

  theta     int;
  xwind     numeric;

  tzname    text;
BEGIN
  wdir_true := NULLIF(NEW.raw_content->>'wind0dir','')::int;
  wavg      := NULLIF(NEW.raw_content->>'wind0avgwind','')::numeric;
  tzname    := NULLIF(NEW.raw_content->>'mbsystemtimezone','');

  -- True -> Magnetic (NZNE variation 19E)
  wdir_mag := CASE
    WHEN wdir_true IS NULL THEN NULL
    ELSE ((wdir_true - 19 + 360) % 360)
  END;

  -- Fav runway based on MAGNETIC direction
  rwy := CASE
    WHEN wdir_mag IS NOT NULL AND wdir_mag BETWEEN 117 AND 297 THEN 'RWY21'
    ELSE 'RWY03'
  END;

  rwyhdg := CASE WHEN rwy = 'RWY21' THEN 207 ELSE 27 END;

  -- Crosswind based on MAGNETIC direction (always positive, rounded 1dp)
  IF wdir_mag IS NULL OR wavg IS NULL THEN
    xwind := NULL;
  ELSE
    theta := abs(wdir_mag - rwyhdg);
    IF theta > 180 THEN theta := 360 - theta; END IF;

    xwind := round(abs((wavg * sin(radians(theta)))::numeric), 1);
  END IF;

  -- Upsert weather_update
  INSERT INTO public.weather_update (
    update_id, captured_at, content_hash, file_size,
    station, timezone, lan_ip,
    device_local_ts, device_utc_ts,
    wind_speed, wind_max_10, wind_max_60, wind_avg,
    wind_dir_deg, wind_dir_deg_mag, wind_dir_min_10, wind_dir_max_10,
    temp_out_c, hum_out_pct, dew_out_c,
    temp_in_c, hum_in_pct, dew_in_c,
    press_hpa, sea_press_hpa,
    rain_rate, rain_total,
    th0_lowbat, thb0_lowbat,
    wind_rwy_fav, wind_xwind,
    raw
  )
  VALUES (
    NEW.id, NEW.captured_at, NEW.content_hash, NEW.file_size,

    NEW.raw_content->>'mbsystemstation',
    tzname,
    NULLIF(NEW.raw_content->>'lanip','')::inet,

    -- device_local_ts: wall clock time (timestamp)
    CASE
      WHEN NEW.raw_content ?& array['currYYYY','currMM','currDD','currhh','currmm','currss'] THEN
        make_timestamp(
          NULLIF(NEW.raw_content->>'currYYYY','')::int,
          NULLIF(NEW.raw_content->>'currMM','')::int,
          NULLIF(NEW.raw_content->>'currDD','')::int,
          NULLIF(NEW.raw_content->>'currhh','')::int,
          NULLIF(NEW.raw_content->>'currmm','')::int,
          NULLIF(NEW.raw_content->>'currss','')::int
        )
      ELSE NULL
    END,

    -- device_utc_ts: prefer Ucurr, else derive from local+timezone
    COALESCE(
      CASE
        WHEN NEW.raw_content ?& array['UcurrYYYY','UcurrMM','UcurrDD','Ucurrhh','Ucurrmm','Ucurrss'] THEN
          make_timestamptz(
            NULLIF(NEW.raw_content->>'UcurrYYYY','')::int,
            NULLIF(NEW.raw_content->>'UcurrMM','')::int,
            NULLIF(NEW.raw_content->>'UcurrDD','')::int,
            NULLIF(NEW.raw_content->>'Ucurrhh','')::int,
            NULLIF(NEW.raw_content->>'Ucurrmm','')::int,
            NULLIF(NEW.raw_content->>'Ucurrss','')::int,
            'UTC'
          )
        ELSE NULL
      END,
      CASE
        WHEN (NEW.raw_content ?& array['currYYYY','currMM','currDD','currhh','currmm','currss'])
             AND tzname IS NOT NULL
        THEN (
          make_timestamp(
            NULLIF(NEW.raw_content->>'currYYYY','')::int,
            NULLIF(NEW.raw_content->>'currMM','')::int,
            NULLIF(NEW.raw_content->>'currDD','')::int,
            NULLIF(NEW.raw_content->>'currhh','')::int,
            NULLIF(NEW.raw_content->>'currmm','')::int,
            NULLIF(NEW.raw_content->>'currss','')::int
          ) AT TIME ZONE tzname
        )
        ELSE NULL
      END
    ),

    NULLIF(NEW.raw_content->>'wind0wind','')::numeric,
    NULLIF(NEW.raw_content->>'wind0windmax10','')::numeric,
    NULLIF(NEW.raw_content->>'wind0windmax60','')::numeric,
    wavg,

    wdir_true,
    wdir_mag,
    NULLIF(NEW.raw_content->>'wind0dirmin10','')::int,
    NULLIF(NEW.raw_content->>'wind0dirmax10','')::int,

    NULLIF(NEW.raw_content->>'th0temp','')::numeric,
    NULLIF(NEW.raw_content->>'th0hum','')::numeric,
    NULLIF(NEW.raw_content->>'th0dew','')::numeric,

    NULLIF(NEW.raw_content->>'thb0temp','')::numeric,
    NULLIF(NEW.raw_content->>'thb0hum','')::numeric,
    NULLIF(NEW.raw_content->>'thb0dew','')::numeric,

    NULLIF(NEW.raw_content->>'thb0press','')::numeric,
    NULLIF(NEW.raw_content->>'thb0seapress','')::numeric,

    NULLIF(NEW.raw_content->>'rain0rate','')::numeric,
    NULLIF(NEW.raw_content->>'rain0total','')::numeric,

    (NULLIF(NEW.raw_content->>'th0lowbat','')::numeric > 0),
    (NULLIF(NEW.raw_content->>'thb0lowbat','')::numeric > 0),

    rwy,
    xwind,

    NEW.raw_content
  )
  ON CONFLICT (update_id) DO UPDATE SET
    captured_at = EXCLUDED.captured_at,
    content_hash = EXCLUDED.content_hash,
    file_size = EXCLUDED.file_size,
    station = EXCLUDED.station,
    timezone = EXCLUDED.timezone,
    lan_ip = EXCLUDED.lan_ip,
    device_local_ts = EXCLUDED.device_local_ts,
    device_utc_ts = EXCLUDED.device_utc_ts,
    wind_speed = EXCLUDED.wind_speed,
    wind_max_10 = EXCLUDED.wind_max_10,
    wind_max_60 = EXCLUDED.wind_max_60,
    wind_avg = EXCLUDED.wind_avg,
    wind_dir_deg = EXCLUDED.wind_dir_deg,
    wind_dir_deg_mag = EXCLUDED.wind_dir_deg_mag,
    wind_dir_min_10 = EXCLUDED.wind_dir_min_10,
    wind_dir_max_10 = EXCLUDED.wind_dir_max_10,
    temp_out_c = EXCLUDED.temp_out_c,
    hum_out_pct = EXCLUDED.hum_out_pct,
    dew_out_c = EXCLUDED.dew_out_c,
    temp_in_c = EXCLUDED.temp_in_c,
    hum_in_pct = EXCLUDED.hum_in_pct,
    dew_in_c = EXCLUDED.dew_in_c,
    press_hpa = EXCLUDED.press_hpa,
    sea_press_hpa = EXCLUDED.sea_press_hpa,
    rain_rate = EXCLUDED.rain_rate,
    rain_total = EXCLUDED.rain_total,
    th0_lowbat = EXCLUDED.th0_lowbat,
    thb0_lowbat = EXCLUDED.thb0_lowbat,
    wind_rwy_fav = EXCLUDED.wind_rwy_fav,
    wind_xwind = EXCLUDED.wind_xwind,
    raw = EXCLUDED.raw;

  -- Trend tables: rewrite for this update_id
  DELETE FROM public.weather_windtrend WHERE update_id = NEW.id;
  DELETE FROM public.weather_winddirtrend WHERE update_id = NEW.id;

  IF jsonb_typeof(NEW.raw_content->'windtrend') = 'array' THEN
    INSERT INTO public.weather_windtrend (update_id, idx, wind)
    SELECT NEW.id, t.ordinality - 1, t.value::numeric
    FROM jsonb_array_elements_text(NEW.raw_content->'windtrend') WITH ORDINALITY AS t(value, ordinality);
  END IF;

  IF jsonb_typeof(NEW.raw_content->'winddirtrend') = 'array' THEN
    INSERT INTO public.weather_winddirtrend (update_id, idx, dir_deg)
    SELECT NEW.id, t.ordinality - 1, t.value::numeric
    FROM jsonb_array_elements_text(NEW.raw_content->'winddirtrend') WITH ORDINALITY AS t(value, ordinality);
  END IF;

  -- Purge trend data older than 5 days
  DELETE FROM public.weather_windtrend
  WHERE update_id IN (
    SELECT id FROM public.weather_data WHERE captured_at < NOW() - INTERVAL '5 days'
  );
  DELETE FROM public.weather_winddirtrend
  WHERE update_id IN (
    SELECT id FROM public.weather_data WHERE captured_at < NOW() - INTERVAL '5 days'
  );

  RETURN NEW;
END;
$function$;

-- ============================================================
-- TRIGGER: fires after each INSERT on weather_data
-- ============================================================

CREATE TRIGGER trg_weather_data_parse
    AFTER INSERT ON weather_data
    FOR EACH ROW
    EXECUTE FUNCTION tr_weather_data_parse();
