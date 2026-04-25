// Using the API key from your OpenWeather Dashboard
const API_KEY = 'ea364aa8f8f76e3c0ccad087090410ff'; 
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

const elements = {
    cityInput: document.getElementById('city-input'),
    searchBtn: document.getElementById('search-btn'),
    voiceBtn: document.getElementById('voice-btn'),
    locationBtn: document.getElementById('location-btn'),
    shareBtn: document.getElementById('share-btn'),
    celsiusBtn: document.getElementById('celsius-btn'),
    fahrenheitBtn: document.getElementById('fahrenheit-btn'),
    currentWeather: document.getElementById('current-weather'),
    forecast: document.getElementById('forecast'),
    hourlyForecast: document.getElementById('hourly-forecast'),
    mapSection: document.getElementById('map-section'),
    compareSection: document.getElementById('compare-section'),
    emptyState: document.getElementById('empty-state'),
    errorMsg: document.getElementById('error-message'),
    alertBanner: document.getElementById('weather-alert'),
    alertText: document.getElementById('alert-text'),
    aqiBadge: document.getElementById('aqi-badge'),
    recentSearches: document.getElementById('recent-searches'),
    compareContainer: document.getElementById('compare-container'),
    addCompareBtn: document.getElementById('add-compare-btn')
};

let currentUnit = 'metric'; 
let lastLat = null; let lastLon = null; let lastCity = null;
let map = null; let currentWeatherLayer = null;
let comparedCities = JSON.parse(localStorage.getItem('comparedCities')) || [];
const compareCache = {}; // Cache to prevent duplicate API calls

// --- Init ---
loadRecentSearches();
renderCompareGrid();

// --- Input Validation ---
function sanitizeInput(input) {
    return /^[a-zA-Z\s,.-]+$/.test(input.trim());
}

// --- Listeners ---
let searchTimeout;
elements.cityInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const val = e.target.value.trim();
    if(val && sanitizeInput(val)) {
        searchTimeout = setTimeout(() => getWeatherData(val), 800);
    }
});
elements.searchBtn.addEventListener('click', () => { 
    const val = elements.cityInput.value.trim();
    if(val) sanitizeInput(val) ? getWeatherData(val) : showError("Invalid city name formatting.");
});
elements.locationBtn.addEventListener('click', getLocalWeather);

elements.celsiusBtn.addEventListener('click', () => switchUnit('metric'));
elements.fahrenheitBtn.addEventListener('click', () => switchUnit('imperial'));

function switchUnit(unit) {
    if (currentUnit !== unit) {
        currentUnit = unit;
        elements.celsiusBtn.classList.toggle('active', unit === 'metric');
        elements.fahrenheitBtn.classList.toggle('active', unit === 'imperial');
        if (lastLat && lastLon) fetchWeatherByCoords(lastLat, lastLon, false); 
    }
}

// --- Voice Search ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    elements.voiceBtn.addEventListener('click', () => {
        elements.voiceBtn.classList.add('listening');
        recognition.start();
    });
    recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        elements.cityInput.value = transcript;
        elements.voiceBtn.classList.remove('listening');
        getWeatherData(transcript);
    };
    recognition.onerror = () => {
        elements.voiceBtn.classList.remove('listening');
        showError("Voice recognition failed.");
    };
} else { elements.voiceBtn.style.display = 'none'; }

// --- Web Share API ---
if (navigator.share) {
    elements.shareBtn.classList.remove('hidden');
    elements.shareBtn.addEventListener('click', () => {
        if(lastCity) {
            navigator.share({
                title: `Weather in ${lastCity}`,
                text: `Check out the weather in ${lastCity}. It's currently ${document.getElementById('temperature').innerText}.`,
                url: window.location.href
            }).catch(console.error);
        }
    });
}

// --- UI Toggles ---
function setSkeleton(state) {
    elements.emptyState.classList.add('hidden');
    if(state) {
        elements.currentWeather.classList.add('isLoading', 'hidden');
        elements.currentWeather.classList.remove('hidden');
    } else {
        elements.currentWeather.classList.remove('isLoading');
    }
}
function showError(msg) {
    setSkeleton(false);
    [elements.currentWeather, elements.forecast, elements.hourlyForecast, elements.mapSection, elements.compareSection].forEach(el => el.classList.add('hidden'));
    elements.errorMsg.innerText = msg; elements.errorMsg.classList.remove('hidden');
}

// --- API Calls ---
async function fetchWeatherByCoords(lat, lon, updateRecent = true) {
    elements.errorMsg.classList.add('hidden'); setSkeleton(true);
    try {
        const [currentRes, forecastRes, aqiRes] = await Promise.all([
            fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=${currentUnit}&appid=${API_KEY}`),
            fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=${currentUnit}&appid=${API_KEY}`),
            fetch(`${BASE_URL}/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`)
        ]);
        
        if (!currentRes.ok) {
            if (currentRes.status === 429) throw new Error("API rate limit reached. Try again later.");
            if (currentRes.status === 404) throw new Error('Location not found.');
            if (currentRes.status === 401) throw new Error('Invalid API key.');
            throw new Error('Data unavailable.');
        }
        
        const currentData = await currentRes.json();
        handleData(currentData, await forecastRes.json(), await aqiRes.json());
        if (updateRecent) saveRecentSearch(currentData.name);
    } catch (error) { showError(error.message); }
}

async function getWeatherData(city) {
    elements.errorMsg.classList.add('hidden'); setSkeleton(true);
    try {
        const currentRes = await fetch(`${BASE_URL}/weather?q=${city}&units=${currentUnit}&appid=${API_KEY}`);
        
        if (!currentRes.ok) {
            if (currentRes.status === 429) throw new Error("API rate limit reached. Try again later.");
            if (currentRes.status === 404) throw new Error('City not found. Please check spelling.');
            if (currentRes.status === 401) throw new Error('Invalid API key.');
            throw new Error('Data unavailable.');
        }
        
        const currentData = await currentRes.json();
        const { lat, lon } = currentData.coord;
        
        const [forecastRes, aqiRes] = await Promise.all([
            fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=${currentUnit}&appid=${API_KEY}`),
            fetch(`${BASE_URL}/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`)
        ]);
        
        handleData(currentData, await forecastRes.json(), await aqiRes.json());
        saveRecentSearch(currentData.name);
    } catch (error) { showError(error.message); }
}

// --- Data Handling ---
function handleData(current, forecast, aqiData) {
    setSkeleton(false);
    elements.emptyState.classList.add('hidden'); // Firmly hide empty state
    
    lastLat = current.coord.lat; lastLon = current.coord.lon; lastCity = current.name;
    
    // Alerts
    const windKmh = currentUnit === 'metric' ? current.wind.speed * 3.6 : current.wind.speed * 1.609;
    if (windKmh > 50 || ['Thunderstorm', 'Tornado', 'Squall'].includes(current.weather[0].main)) {
        elements.alertText.innerText = `Severe Weather Alert: High Winds or Storms in ${current.name}`;
        elements.alertBanner.classList.remove('hidden');
    } else { elements.alertBanner.classList.add('hidden'); }

    // AQI
    if (aqiData && aqiData.list.length > 0) {
        const aqi = aqiData.list[0].main.aqi;
        const aqiLabels = {1: 'Good 🟢', 2: 'Fair 🟡', 3: 'Moderate 🟠', 4: 'Poor 🔴', 5: 'Hazardous 🟤'};
        elements.aqiBadge.innerText = `AQI: ${aqiLabels[aqi]}`;
        elements.aqiBadge.classList.remove('hidden');
    }

    updateTheme(current.weather[0].main, current.dt, current.sys.sunrise, current.sys.sunset);

    document.getElementById('city-name').innerText = `${current.name}, ${current.sys.country}`;
    document.getElementById('date-time').innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('temperature').innerText = `${Math.round(current.main.temp)}°`;
    document.getElementById('condition').innerText = current.weather[0].description;
    document.getElementById('feels-like').innerHTML = `${Math.round(current.main.feels_like)}°`;
    document.getElementById('humidity').innerText = `${current.main.humidity}%`;
    document.getElementById('wind-speed').innerText = currentUnit === 'metric' ? `${Math.round(current.wind.speed * 3.6)} km/h` : `${Math.round(current.wind.speed)} mph`;
    document.getElementById('weather-icon').src = `https://openweathermap.org/img/wn/${current.weather[0].icon}@4x.png`;
    
    // Forecast Renders
    document.getElementById('hourly-container').innerHTML = '';
    forecast.list.slice(0, 8).forEach(item => {
        const time = new Date((item.dt + forecast.city.timezone) * 1000).toUTCString().match(/(\d{2}:\d{2})/)[0];
        document.getElementById('hourly-container').insertAdjacentHTML('beforeend', `
            <div class="hourly-card"><p>${time}</p><img src="https://openweathermap.org/img/wn/${item.weather[0].icon}.png" alt="icon"><h4>${Math.round(item.main.temp)}°</h4></div>`);
    });

    document.getElementById('forecast-container').innerHTML = '';
    forecast.list.filter(item => item.dt_txt.includes('12:00:00')).forEach(day => {
        const date = new Date((day.dt + forecast.city.timezone)*1000).toUTCString().substring(0, 11);
        document.getElementById('forecast-container').insertAdjacentHTML('beforeend', `
            <div class="forecast-card"><p>${date}</p><img src="https://openweathermap.org/img/wn/${day.weather[0].icon}.png" alt="icon"><h4>${Math.round(day.main.temp)}°</h4></div>`);
    });

    updateMap(lastLat, lastLon);
    [elements.currentWeather, elements.forecast, elements.hourlyForecast, elements.mapSection, elements.compareSection].forEach(el => el.classList.remove('hidden'));
}

function updateTheme(weatherMain, dt, sunrise, sunset) {
    const root = document.documentElement;
    const animLayer = document.getElementById('weather-animation-layer');
    animLayer.className = ''; 
    const isDay = dt > sunrise && dt < sunset;
    
    root.style.setProperty('--glass-bg', isDay ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)');
    root.style.setProperty('--glass-border', isDay ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.05)');

    let colors = isDay ? ['#4ca1af', '#c4e0e5', '#4ca1af', '#000000'] : ['#0f2027', '#203a43', '#2c5364', '#00e5ff'];
    if(weatherMain.toLowerCase() === 'rain') { animLayer.classList.add('rain-effect'); }
    if(weatherMain.toLowerCase() === 'thunderstorm') { animLayer.classList.add('rain-effect', 'thunder-effect'); colors = ['#000', '#434343', '#000', '#7600bc']; }

    root.style.setProperty('--bg-color-1', colors[0]); root.style.setProperty('--bg-color-2', colors[1]);
    root.style.setProperty('--bg-color-3', colors[2]); root.style.setProperty('--neon-accent', colors[3]);
}

function updateMap(lat, lon, layerType = 'precipitation_new') {
    if (!map) { 
        map = L.map('weather-map').setView([lat, lon], 10); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map); 
    } else { 
        map.setView([lat, lon], 10); 
    }
    if (currentWeatherLayer) map.removeLayer(currentWeatherLayer); 
    currentWeatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/${layerType}/{z}/{x}/{y}.png?appid=${API_KEY}`, { opacity: 0.7 }).addTo(map);
}
document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active');
        if (lastLat && lastLon) updateMap(lastLat, lastLon, e.target.dataset.layer);
    });
});

// --- Local Storage & Compare Grid ---
function saveRecentSearch(city) {
    let searches = JSON.parse(localStorage.getItem('recentCities')) || [];
    if (!searches.includes(city)) { searches.unshift(city); if (searches.length > 5) searches.pop(); localStorage.setItem('recentCities', JSON.stringify(searches)); loadRecentSearches(); }
}
function loadRecentSearches() {
    let searches = JSON.parse(localStorage.getItem('recentCities')) || [];
    elements.recentSearches.innerHTML = '';
    searches.forEach(city => {
        const btn = document.createElement('button'); btn.innerText = city; btn.onclick = () => getWeatherData(city);
        elements.recentSearches.appendChild(btn);
    });
}

elements.addCompareBtn.addEventListener('click', () => {
    if(lastCity && !comparedCities.includes(lastCity) && comparedCities.length < 3) {
        comparedCities.push(lastCity);
        localStorage.setItem('comparedCities', JSON.stringify(comparedCities));
        renderCompareGrid();
    }
});

async function renderCompareGrid() {
    const container = elements.compareContainer;
    container.innerHTML = '';
    container.appendChild(elements.addCompareBtn);
    
    for (const city of comparedCities) {
        try {
            let data;
            // Check cache first
            if (compareCache[city]) {
                data = compareCache[city];
            } else {
                const res = await fetch(`${BASE_URL}/weather?q=${city}&units=${currentUnit}&appid=${API_KEY}`);
                data = await res.json();
                compareCache[city] = data; // Store in cache
            }

            const card = document.createElement('div');
            card.className = 'compare-card';
            card.innerHTML = `<h4>${data.name}</h4><h2>${Math.round(data.main.temp)}°</h2><img src="https://openweathermap.org/img/wn/${data.weather[0].icon}.png" alt="icon"><p>${data.weather[0].main}</p><button class="icon-btn" onclick="removeCompare('${city}')" style="margin-top:10px"><i class="fas fa-trash"></i></button>`;
            container.insertBefore(card, elements.addCompareBtn);
        } catch (e) { console.error("Compare fetch error", e); }
    }
}
window.removeCompare = (city) => {
    comparedCities = comparedCities.filter(c => c !== city);
    localStorage.setItem('comparedCities', JSON.stringify(comparedCities));
    renderCompareGrid();
}

// --- PWA Service Worker Registration & Offline Logic ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Registered!'))
            .catch(err => console.error('Service Worker Registration Failed!', err));
    });
}

window.addEventListener('offline', () => {
    showError("You are currently offline. Displaying last known weather data.");
    [elements.currentWeather, elements.forecast, elements.hourlyForecast].forEach(el => el.classList.remove('hidden'));
});

window.addEventListener('online', () => {
    elements.errorMsg.classList.add('hidden');
    if (lastLat && lastLon) fetchWeatherByCoords(lastLat, lastLon, false);
});

// --- Geolocation Initial Call ---
function getLocalWeather() {
    if (navigator.geolocation) {
        setSkeleton(true);
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
            err => {
                showError("Location access denied. Please search manually.");
                elements.emptyState.classList.remove('hidden');
            }
        );
    } else {
        elements.emptyState.classList.remove('hidden');
    }
}

// Fire the initial app load automatically
getLocalWeather();
