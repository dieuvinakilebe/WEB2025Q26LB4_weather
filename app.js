'use strict';

var STORAGE_KEY = 'weather_app_state_v1';

var state = {
  locations: [],
  selectedId: null
};

var cache = {};

var elList = document.getElementById('locationsList');
var elStatus = document.getElementById('status');
var elWeather = document.getElementById('weatherView');

var elFormTitle = document.getElementById('formTitle');
var elForm = document.getElementById('cityForm');
var elInput = document.getElementById('cityInput');
var elSugg = document.getElementById('suggestions');
var elErr = document.getElementById('cityError');

var elBtnRefresh = document.getElementById('btnRefresh');

// выбранная подсказка из списка
var selectedSuggestion = null;

// таймер для задержки запросов подсказок
var suggestTimer = null;

document.addEventListener('DOMContentLoaded', function () {
  loadState();

  elBtnRefresh.addEventListener('click', function () {
    refreshAll();
  });

  elForm.addEventListener('submit', function (e) {
    e.preventDefault();
    onAddCity();
  });

  elInput.addEventListener('input', function () {
    selectedSuggestion = null;
    elErr.textContent = '';
    scheduleSuggestions(elInput.value);
  });

  initApp();
});

function initApp() {
  renderLocations();

  if (state.locations.length === 0) {
    setStatus('loading', 'Запрашиваю геолокацию...');
    requestGeo();
    elFormTitle.textContent = 'Город вместо гео';
    return;
  }

  if (!state.selectedId) state.selectedId = state.locations[0].id;
  saveState();

  selectLocation(state.selectedId);
  refreshAll(); // при перезагрузке снова запросы
}

function requestGeo() {
  if (!navigator.geolocation) {
    setStatus('error', 'Геолокация не поддерживается. Введите город.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (pos) {
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;

      var loc = {
        id: 'geo',
        type: 'geo',
        name: 'Текущее местоположение',
        lat: lat,
        lon: lon
      };

      state.locations = [loc];
      state.selectedId = loc.id;
      saveState();

      clearStatus();
      renderLocations();
      selectLocation(loc.id);
      refreshAll();
    },
    function () {
      setStatus('error', 'Нет доступа к гео. Введите город.');
      elFormTitle.textContent = 'Город вместо гео';
    },
    { timeout: 10000 }
  );
}

function onAddCity() {
  var text = (elInput.value || '').trim();

  if (!text) {
    elErr.textContent = 'Введите город.';
    return;
  }

  elErr.textContent = '';
  setStatus('loading', 'Ищу город и загружаю прогноз...');

  // если кликнули по подсказке — берём её
  // если не кликнули — всё равно пробуем найти город через API
  var promise = selectedSuggestion ? Promise.resolve(selectedSuggestion) : geocodeFirst(text);

  promise
    .then(function (geo) {
      if (!geo) {
        clearStatus();
        elErr.textContent = 'Город не найден.';
        return;
      }

      var locId = 'city_' + geo.id;

      if (hasLocationId(locId)) {
        clearStatus();
        elErr.textContent = 'Этот город уже добавлен.';
        return;
      }

      var loc = {
        id: locId,
        type: 'city',
        name: geo.name,
        lat: geo.lat,
        lon: geo.lon
      };

      if (state.locations.length === 0) {
        state.locations = [loc];
        state.selectedId = loc.id;
      } else {
        state.locations.push(loc);
      }

      saveState();
      elInput.value = '';
      selectedSuggestion = null;
      elSugg.innerHTML = '';
      clearStatus();

      renderLocations();
      selectLocation(state.selectedId);
      refreshAll();
    })
    .catch(function (err) {
      setStatus('error', 'Ошибка: ' + err.message);
    });
}

function scheduleSuggestions(value) {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(function () {
    renderSuggestions(value);
  }, 250);
}

function renderSuggestions(value) {
  var q = (value || '').trim();
  elSugg.innerHTML = '';

  if (q.length < 2) return;

  fetch(
    'https://geocoding-api.open-meteo.com/v1/search' +
      '?name=' + encodeURIComponent(q) +
      '&count=6' +
      '&language=ru'
  )
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      elSugg.innerHTML = '';
      if (!data || !data.results || data.results.length === 0) return;

      var box = document.createElement('div');
      box.className = 'sugg-box';

      data.results.forEach(function (x) {
        var label = makeCityLabel(x);

        var item = document.createElement('div');
        item.className = 'sugg-item';
        item.textContent = label;

        item.addEventListener('click', function () {
          selectedSuggestion = {
            id: x.id,
            name: label,
            lat: x.latitude,
            lon: x.longitude
          };
          elInput.value = label;
          elSugg.innerHTML = '';
          elErr.textContent = '';
        });

        box.appendChild(item);
      });

      elSugg.appendChild(box);
    })
    .catch(function () {
      // если подсказки не загрузились — не ломаем UI
    });
}

function makeCityLabel(x) {
  var parts = [];
  var seen = {};

  function add(val) {
    var s = (val || '').trim();
    if (!s) return;
    var key = s.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    parts.push(s);
  }

  add(x.name);
  add(x.admin1);
  add(x.country);

  return parts.join(', ');
}


function geocodeFirst(name) {
  var url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    '?name=' + encodeURIComponent(name) +
    '&count=1' +
    '&language=ru';

  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.results || !data.results.length) return null;
      var x = data.results[0];
      return {
        id: x.id,
        name: makeCityLabel(x),
        lat: x.latitude,
        lon: x.longitude
      };
    });
}

function hasLocationId(id) {
  for (var i = 0; i < state.locations.length; i++) {
    if (state.locations[i].id === id) return true;
  }
  return false;
}

function renderLocations() {
  elList.innerHTML = '';

  if (state.locations.length === 0) {
    var liEmpty = document.createElement('li');
    liEmpty.textContent = 'Нет локаций';
    elList.appendChild(liEmpty);
    return;
  }

  state.locations.forEach(function (loc, idx) {
    var li = document.createElement('li');
    li.className = 'loc-item';

    var btn = document.createElement('button');
    btn.className = 'loc-btn' + (loc.id === state.selectedId ? ' active' : '');
    btn.textContent = loc.name;
    btn.addEventListener('click', function () {
      state.selectedId = loc.id;
      saveState();
      renderLocations();
      selectLocation(loc.id);
    });

    li.appendChild(btn);

    if (idx !== 0 && loc.type === 'city') {
      var del = document.createElement('button');
      del.className = 'loc-del';
      del.textContent = '×';
      del.title = 'Удалить';
      del.addEventListener('click', function () {
        removeLocation(loc.id);
      });
      li.appendChild(del);
    }

    elList.appendChild(li);
  });
}

function removeLocation(id) {
  state.locations = state.locations.filter(function (x) {
    return x.id !== id;
  });
  delete cache[id];

  if (state.selectedId === id) {
    state.selectedId = state.locations.length ? state.locations[0].id : null;
  }

  saveState();
  renderLocations();

  if (state.selectedId) {
    selectLocation(state.selectedId);
  } else {
    elWeather.innerHTML = '';
    setStatus('error', 'Локаций нет. Добавьте город.');
  }
}

function selectLocation(id) {
  var loc = findLocation(id);
  if (!loc) return;

  if (cache[id]) {
    renderWeather(loc, cache[id]);
  } else {
    elWeather.innerHTML = '';
    setStatus('loading', 'Загрузка...');
    fetchForecast(loc)
      .then(function (data) {
        cache[id] = data;
        clearStatus();
        renderWeather(loc, data);
      })
      .catch(function (err) {
        setStatus('error', 'Ошибка: ' + err.message);
      });
  }
}

function refreshAll() {
  if (state.locations.length === 0) return;

  setStatus('loading', 'Обновляю погоду...');

  var chain = Promise.resolve();

  state.locations.forEach(function (loc) {
    chain = chain.then(function () {
      return fetchForecast(loc).then(function (data) {
        cache[loc.id] = data;
      });
    });
  });

  chain
    .then(function () {
      clearStatus();
      renderLocations();
      selectLocation(state.selectedId);
    })
    .catch(function (err) {
      setStatus('error', 'Ошибка: ' + err.message);
    });
}

function fetchForecast(loc) {
  var url = buildForecastUrl(loc.lat, loc.lon);

  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function buildForecastUrl(lat, lon) {
  var base = 'https://api.open-meteo.com/v1/forecast';
  var params =
    '?latitude=' + encodeURIComponent(lat) +
    '&longitude=' + encodeURIComponent(lon) +
    '&current=temperature_2m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max' +
    '&forecast_days=3' +
    '&timezone=auto';

  return base + params;
}

function renderWeather(loc, data) {
  var cur = readCurrent(data);
  var daily = readDaily(data);

  var html = '';
  html += '<h2 class="weather-title">' + escapeHtml(loc.name) + '</h2>';

  if (cur) {
    html += '<div class="current">';
    html += '<div class="big">' + Math.round(cur.temp) + '°C</div>';
    html += '<div>' + codeToEmoji(cur.code) + ' ' + codeToText(cur.code) + '</div>';
    html += '</div>';
  }

  html += '<div class="days">';
  for (var i = 0; i < daily.length; i++) {
    var d = daily[i];
    html += '<div class="day-card">';
    html += '<div class="day-name">' + dayLabel(i, d.date) + '</div>';
    html += '<div class="day-row">' + codeToEmoji(d.code) + ' ' + codeToText(d.code) + '</div>';
    html += '<div class="day-row">Макс: ' + Math.round(d.tmax) + '°C</div>';
    html += '<div class="day-row">Мин: ' + Math.round(d.tmin) + '°C</div>';
    if (d.pop != null) html += '<div class="day-row">Осадки: ' + Math.round(d.pop) + '%</div>';
    html += '</div>';
  }
  html += '</div>';

  elWeather.innerHTML = html;
}

function readCurrent(data) {
  if (data && data.current && data.current.temperature_2m != null) {
    return { temp: data.current.temperature_2m, code: data.current.weather_code };
  }
  if (data && data.current_weather && data.current_weather.temperature != null) {
    return { temp: data.current_weather.temperature, code: data.current_weather.weathercode };
  }
  return null;
}

function readDaily(data) {
  var out = [];
  if (!data || !data.daily) return out;

  var t = data.daily.time || [];
  var tmax = data.daily.temperature_2m_max || [];
  var tmin = data.daily.temperature_2m_min || [];
  var code = data.daily.weather_code || [];
  var pop = data.daily.precipitation_probability_max || [];

  for (var i = 0; i < 3; i++) {
    out.push({
      date: t[i],
      tmax: tmax[i],
      tmin: tmin[i],
      code: code[i],
      pop: pop[i]
    });
  }

  return out;
}

function dayLabel(i, dateStr) {
  if (i === 0) return 'Сегодня';
  if (i === 1) return 'Завтра';
  if (i === 2) return 'Послезавтра';
  return dateStr || '';
}

function codeToText(code) {
  var c = Number(code);

  if (c === 0) return 'Ясно';
  if (c === 1 || c === 2) return 'Малооблачно';
  if (c === 3) return 'Облачно';
  if (c === 45 || c === 48) return 'Туман';

  if (c === 51 || c === 53 || c === 55) return 'Морось';
  if (c === 56 || c === 57) return 'Ледяная морось';

  if (c === 61 || c === 63 || c === 65) return 'Дождь';
  if (c === 66 || c === 67) return 'Ледяной дождь';

  if (c === 71 || c === 73 || c === 75) return 'Снег';
  if (c === 77) return 'Снежные зерна';

  if (c === 80 || c === 81 || c === 82) return 'Ливни';
  if (c === 85 || c === 86) return 'Снегопад';

  if (c === 95) return 'Гроза';
  if (c === 96 || c === 99) return 'Гроза с градом';

  return 'Неизвестно';
}

function codeToEmoji(code) {
  var c = Number(code);

  if (c === 0) return '☀️';
  if (c === 1 || c === 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';

  if (c >= 51 && c <= 57) return '🌦️';
  if (c >= 61 && c <= 67) return '🌧️';
  if (c >= 71 && c <= 77) return '❄️';
  if (c >= 80 && c <= 86) return '🌧️';
  if (c >= 95) return '⛈️';

  return '🌡️';
}

function findLocation(id) {
  for (var i = 0; i < state.locations.length; i++) {
    if (state.locations[i].id === id) return state.locations[i];
  }
  return null;
}

function setStatus(type, text) {
  elStatus.className = 'status ' + type;
  elStatus.textContent = text;
  elStatus.style.display = 'block';
}

function clearStatus() {
  elStatus.textContent = '';
  elStatus.style.display = 'none';
  elStatus.className = 'status';
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var obj = JSON.parse(raw);
    if (!obj || !obj.locations) return;

    state.locations = obj.locations;
    state.selectedId = obj.selectedId || null;
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

