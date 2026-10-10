(function () {
    /*  CẤU HÌNH API CHUẨN  */
    var API = 'https://phimapi.com';
    var CDN_IMG = 'https://phimimg.com';
    var UPLOAD_IMG = 'https://phimapi.com/uploads/movies/';
    var PROXY = 'https://api.codetabs.com/v1/proxy?quest=';

    var $ = function (s, r) { return (r || document).querySelector(s); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ic(n) { return '<svg aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
    function plain(h) { try { return new DOMParser().parseFromString(h || '', 'text/html').body.textContent || ''; } catch (e) { return ''; } }

    // Xử lý chuẩn xác mọi định dạng ảnh
    function img(u) {
        if (!u) return '';
        u = String(u).trim();
        if (/^https?:\/\//i.test(u)) return u;
        if (/^\/\//.test(u)) return 'https:' + u;

        // Loại bỏ dấu gạch chéo ở đầu nếu có
        var cleanPath = u.replace(/^\/+/, '');

        // Nếu đường dẫn chứa vod hoặc upload
        if (cleanPath.indexOf('upload/vod/') > -1 || cleanPath.indexOf('uploads/') > -1) {
            return 'https://phimimg.com/' + cleanPath;
        }

        // Các ảnh chỉ có hash tên file (ví dụ: a5f56a6...jpg)
        return 'https://phimimg.com/uploads/movies/' + cleanPath;
    }

    function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
    function typeLabel(t) { return (t === 'tv' || t === 'series' || t === 'hoathinh') ? 'Phim bộ' : 'Phim lẻ'; }
    function up(u) { return (location.protocol === 'https:' && /^http:\/\//i.test(u)) ? 'https://' + u.slice(7) : u; }

    // Gọi API linh hoạt (Ưu tiên trực tiếp, fallback proxy khi dính CORS)
    function api(path) {
        var u = (path.startsWith('http') ? path : API + path);
        function req(targetUrl) {
            return fetch(targetUrl).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        }
        return req(u).catch(function () {
            if (PROXY) return req(PROXY + encodeURIComponent(u));
            throw new Error('Lỗi kết nối mạng');
        });
    }

    // Chuẩn hóa tập phim (Khớp cả /phim/{slug} và /v1/api/phim/{slug})
    function normEps(list) {
        return (Array.isArray(list) ? list : []).map(function (sv, i) {
            var data = sv.server_data || sv.items || [];
            return {
                server_name: sv.server_name || sv.name || ('Server ' + (i + 1)),
                server_data: (Array.isArray(data) ? data : []).map(function (e) {
                    var m3 = e.link_m3u8 || e.m3u8 || '';
                    var em = e.link_embed || e.embed || '';
                    var lk = e.link || '';
                    if (lk) {
                        if (/\.m3u8(\?|$)/i.test(lk)) m3 = m3 || lk;
                        else em = em || lk;
                    }
                    return { name: e.name || e.filename || '', slug: e.slug || '', link_m3u8: up(m3), link_embed: up(em) };
                })
            };
        }).filter(function (sv) { return sv.server_data.length > 0; });
    }

    /*  STATE QUẢN LÝ DỮ LIỆU */
    var S = {
        items: [],
        by: {},
        page: 1,
        pages: 1,
        loading: false,
        err: '',
        cur: null,
        det: null,
        srv: 0,
        ep: 0,
        mode: 'hls',
        cache: {},
        filterType: 'latest', // 'latest', 'movie', 'tv', 'genre', 'country', 'year', 'search'
        filterVal: '',
        searchKey: ''
    };

    function mapItem(x) {
        var t = x.tmdb || {};
        // Ưu tiên poster_url (ảnh dọc) làm avatar chính
        var mainPoster = x.poster_url || x.thumb_url || '';
        var backdropImg = x.thumb_url || x.poster_url || '';

        return {
            slug: x.slug,
            name: x.name || '',
            origin: x.origin_name || '',
            year: x.year || '',
            poster: img(mainPoster),    // Avatar dọc chính thức
            poster2: img(backdropImg),  // Ảnh ngang dự phòng/làm nền player
            type: x.type || t.type || null,
            rating: parseFloat(t.vote_average) || 0
        };
    }

    function addItems(list, reset) {
        if (reset) { S.items = []; S.by = {}; }
        list.forEach(function (x) {
            if (!x || !x.slug || S.by[x.slug]) return;
            var m = mapItem(x);
            S.by[m.slug] = m;
            S.items.push(m);
        });
    }

    function pic(it, eager) {
        // Luôn ưu tiên it.poster (ảnh dọc)
        var src = it.poster || it.poster2 || '';
        var alt = it.poster2 || '';
        var imgHtml = '<img src="' + esc(src) + '"' +
            (alt && alt !== src ? ' data-alt="' + esc(alt) + '"' : '') +
            ' alt="' + esc(it.name) + '" referrerpolicy="no-referrer" ' +
            (eager ? '' : 'loading="lazy" ') + 'decoding="async">';
        return '<span class="poster" data-t="' + esc(it.name) + '">' + imgHtml + '</span>';
    }

    // Tự động hoán đổi poster dự phòng nếu link chính 404
    document.addEventListener('error', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'IMG' || !t.closest('.poster')) return;
        if (t.dataset.alt) {
            var a = t.dataset.alt;
            t.removeAttribute('data-alt');
            t.src = a;
        } else {
            t.closest('.poster').classList.add('broken');
        }
    }, true);

    /*  DANH SÁCH YÊU THÍCH (LOCALSTORAGE)  */
    var mem = [];
    function getList() { try { var v = localStorage.getItem('ln-list-v2'); if (v) return JSON.parse(v); } catch (e) { } return mem; }
    function setList(l) { mem = l; try { localStorage.setItem('ln-list-v2', JSON.stringify(l)); } catch (e) { } }
    function inList(slug) { return getList().some(function (x) { return x.slug === slug; }); }
    function toggleList(slug) {
        var it = S.by[slug] || getList().filter(function (x) { return x.slug === slug; })[0];
        if (!it) return;
        var l = getList().slice(), k = -1;
        l.forEach(function (x, i) { if (x.slug === slug) k = i; });
        if (k > -1) { l.splice(k, 1); toast('Đã xóa khỏi danh sách'); }
        else { l.push(it); toast('Đã thêm vào danh sách'); }
        setList(l); renderRows(); renderFeat(); if (S.cur) paintListBtn();
    }
    var tt;
    function toast(m) {
        var t = $('#toast');
        t.textContent = m;
        t.classList.add('on');
        clearTimeout(tt);
        tt = setTimeout(function () { t.classList.remove('on'); }, 2200);
    }

    /*  RENDER GIAO DIỆN  */
    function card(it) {
        return '<button class="card" data-slug="' + esc(it.slug) + '" aria-label="Xem ' + esc(it.name) + '">' +
            pic(it) +
            '<span class="c-title">' + esc(it.name) + '</span>' +
            '<span class="c-meta">' + esc([it.year, typeLabel(it.type)].filter(Boolean).join(' · ')) + '</span>' +
            '</button>';
    }

    function skel(n, cls) {
        var h = '';
        for (var i = 0; i < n; i++) h += cls ? '<div class="card"><div class="sk"></div></div>' : '<div class="sk"></div>';
        return h;
    }

    function renderWall() {
        if (!S.items.length) { $('#wall').innerHTML = ''; return; }
        var h = '', n = S.items.length;
        for (var c = 0; c < 11; c++) {
            h += '<div class="wcol">';
            for (var r = 0; r < 6; r++) { h += pic(S.items[(c * 5 + r * 7 + c) % n], true); }
            h += '</div>';
        }
        $('#wall').innerHTML = h;
    }

    function featExtra(d) {
        if (!d) return '';
        var m = d.movie || (d.data && d.data.item) || {};
        var dir = (m.director || []).filter(Boolean).join(', ') || 'Đang cập nhật';
        var cat = (m.category || []).map(function (c) { return c.name; }).join(', ') || 'Đang cập nhật';
        var ctr = (m.country || []).map(function (c) { return c.name; }).join(', ') || 'Đang cập nhật';
        return '<div class="credit"><div><small>Đạo diễn</small><span>' + esc(dir) + '</span></div><div><small>Thể loại</small><span>' + esc(cat) + '</span></div><div><small>Quốc gia</small><span>' + esc(ctr) + '</span></div></div>';
    }

    function renderFeat() {
        var box = $('#feat');
        if (S.err && !S.items.length) {
            box.innerHTML = '<div class="empty" style="grid-column:1/-1;width:100%">Chưa tải được phim nổi bật.</div>';
            return;
        }
        var it = S.items[0];
        if (!it) {
            box.innerHTML = '<div class="sk" style="max-width:360px;width:100%"></div><div class="feat-body"><div class="sk" style="aspect-ratio:auto;height:180px"></div></div>';
            return;
        }
        var d = S.cache[it.slug], m = (d && (d.movie || (d.data && d.data.item))) || {}, on = inList(it.slug);
        var syn = plain(m.content);
        box.innerHTML = '<button class="poster-btn" data-slug="' + esc(it.slug) + '" aria-label="Xem ' + esc(it.name) + '" style="display:block;max-width:360px;width:100%">' + pic(it, true) + '</button>' +
            '<div class="feat-body"><div class="meta">' +
            (m.quality ? '<span class="tag">' + esc(m.quality) + '</span>' : '') +
            (m.lang ? '<span>' + esc(m.lang) + '</span>' : '') +
            (it.year ? '<span>' + esc(it.year) + '</span>' : '') +
            (typeLabel(it.type) ? '<span>' + typeLabel(it.type) + '</span>' : '') +
            (m.episode_current ? '<span>' + esc(m.episode_current) + '</span>' : '') +
            (it.rating > 0 ? '<span class="tag">TMDB ' + it.rating.toFixed(1) + '</span>' : '') +
            '</div>' +
            '<h3>' + esc(it.name) + '</h3>' +
            (it.origin ? '<div class="orig">' + esc(it.origin) + '</div>' : '') +
            (syn ? '<p>' + esc(syn) + '</p>' : '') +
            '<div class="feat-act">' +
            '<button class="btn btn-blue" data-slug="' + esc(it.slug) + '">' + ic('play') + 'Xem ngay</button>' +
            '<button class="btn btn-ghost" data-list="' + esc(it.slug) + '">' + ic(on ? 'check' : 'plus') + (on ? 'Trong danh sách' : 'Danh sách của tôi') + '</button>' +
            '</div>' + featExtra(d) + '</div>';
    }

    function rowHTML(id, eyebrow, title, list, loading) {
        return '<section class="row-sec" ' + (list.length || loading ? '' : 'hidden') + '>' +
            '<div class="row-head">' +
            '<button class="arrow" data-scroll="' + id + '" data-dir="-1" aria-label="Cuộn trái">' + ic('left') + '</button>' +
            '<div class="mid"><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2></div>' +
            '<button class="arrow" data-scroll="' + id + '" data-dir="1" aria-label="Cuộn phải">' + ic('right') + '</button>' +
            '</div>' +
            '<div class="track" id="' + id + '">' + (loading && !list.length ? skel(8, 1) : list.map(card).join('')) + '</div>' +
            '</section>';
    }

    function renderRows() {
        var mine = getList();
        var loading = S.loading && !S.items.length;
        $('#rows').innerHTML = rowHTML('r-mine', 'Dành riêng cho bạn', 'Danh sách của tôi', mine, false) +
            rowHTML('r-new', 'Phim vừa cập nhật', 'Mới cập nhật', S.items.slice(0, 14), loading);
    }

    function renderChips() {
        var chips = [
            ['latest', 'Tất cả'],
            ['movie', 'Phim lẻ'],
            ['tv', 'Phim bộ']
        ];
        $('#chips').innerHTML = chips.map(function (c) {
            return '<button class="chip" data-chip="' + c[0] + '" aria-pressed="' + (S.filterType === c[0]) + '">' + c[1] + '</button>';
        }).join('');
    }

    function renderGrid() {
        var g = $('#grid'), more = $('#more');
        if (S.loading && !S.items.length) { g.innerHTML = skel(12); more.hidden = true; return; }
        if (S.err && !S.items.length) {
            g.innerHTML = '<div class="empty">Không tải được phim.<small>' + esc(S.err) + '</small><button class="btn btn-ghost" data-retry="1">Thử lại</button></div>';
            more.hidden = true;
            return;
        }
        g.innerHTML = S.items.length ? S.items.map(card).join('') : '<div class="empty">Không tìm thấy bộ phim nào phù hợp.</div>';
        more.hidden = !(S.page < S.pages);
        $('#more-btn').disabled = S.loading;
        $('#more-btn').textContent = S.loading ? 'Đang tải…' : 'Xem thêm phim';
    }

    /*  KHỞI TẠO ROUTE CHO TỪNG LOẠI API  */
    function buildPath(page) {
        if (S.filterType === 'search') {
            return '/v1/api/tim-kiem?keyword=' + encodeURIComponent(S.searchKey) + '&page=' + page + '&limit=24';
        }
        if (S.filterType === 'genre') {
            return '/v1/api/the-loai/' + encodeURIComponent(S.filterVal) + '?page=' + page + '&limit=24';
        }
        if (S.filterType === 'country') {
            return '/v1/api/quoc-gia/' + encodeURIComponent(S.filterVal) + '?page=' + page + '&limit=24';
        }
        if (S.filterType === 'year') {
            return '/v1/api/nam-phat-hanh/' + encodeURIComponent(S.filterVal) + '?page=' + page + '&limit=24';
        }
        if (S.filterType === 'movie') {
            return '/v1/api/danh-sach/phim-le?page=' + page + '&limit=24';
        }
        if (S.filterType === 'tv') {
            return '/v1/api/danh-sach/phim-bo?page=' + page + '&limit=24';
        }
        // Mặc định: Phim mới cập nhật
        return '/danh-sach/phim-moi-cap-nhat?page=' + page;
    }

    function fetchMovies(page, isReset) {
        if (S.loading) return Promise.resolve();
        S.loading = true; S.err = '';
        if (isReset) { S.items = []; renderGrid(); }

        var reqPath = buildPath(page);

        return api(reqPath).then(function (res) {
            // Bóc tách items từ mọi biến thể JSON
            var list = res.items || (res.data && res.data.items) || [];
            var pg = res.pagination || (res.data && res.data.params && res.data.params.pagination) || {};

            addItems(list, isReset);
            S.page = pg.currentPage || page;
            S.pages = pg.totalPages || (pg.totalItems && Math.ceil(pg.totalItems / (pg.totalItemsPerPage || 24))) || 1;
            S.loading = false;

            renderGrid();
            if (isReset && S.filterType === 'latest') {
                renderRows();
                renderWall();
                loadFeat();
            }
        }).catch(function (e) {
            S.loading = false;
            S.err = (e && e.message) || 'Lỗi mạng khi tải phim';
            renderGrid();
        });
    }

    function detail(slug) {
        if (S.cache[slug]) return Promise.resolve(S.cache[slug]);
        return api('/phim/' + encodeURIComponent(slug)).then(function (d) {
            var movie = d.movie || (d.data && d.data.item);
            if (!movie) throw new Error((d && d.msg) || 'Không có dữ liệu phim');
            d.movie = movie;
            d.episodes = normEps(d.episodes || (d.data && d.data.item && d.data.item.episodes));
            S.cache[slug] = d;
            return d;
        });
    }

    function loadFeat() {
        var it = S.items[0];
        if (!it) return;
        detail(it.slug).then(function () { renderFeat(); }).catch(function () { });
    }

    // Tự động kéo danh mục Thể loại và Quốc gia từ chính API
    function initFilters() {
        // 1. Thể loại từ /the-loai
        api('/the-loai').then(function (res) {
            var items = (res.data && res.data.items) || res.items || [];
            var selG = $('#sel-genre');
            items.forEach(function (g) {
                var opt = document.createElement('option');
                opt.value = g.slug;
                opt.textContent = g.name;
                selG.appendChild(opt);
            });
        }).catch(function () { });

        // 2. Quốc gia từ /quoc-gia
        api('/quoc-gia').then(function (res) {
            var items = (res.data && res.data.items) || res.items || [];
            var selC = $('#sel-country');
            items.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.slug;
                opt.textContent = c.name;
                selC.appendChild(opt);
            });
        }).catch(function () { });

        // 3. Danh sách năm (2026 về 2012)
        var selY = $('#sel-year');
        for (var y = 2026; y >= 2012; y--) {
            var opt = document.createElement('option');
            opt.value = y;
            opt.textContent = 'Năm ' + y;
            selY.appendChild(opt);
        }
    }

    /*  TRÌNH PHÁT VIDEO  */
    var hls = null, lastFocus = null;
    function destroyPlayer() {
        if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
        var v = $('#screen video');
        if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { } }
        $('#screen').innerHTML = '';
    }

    function backdrop(it) {
        var u = it && (it.poster2 || it.poster);
        return u ? '<img class="bd" src="' + esc(u) + '" alt="" referrerpolicy="no-referrer">' : '';
    }

    function screenMsg(text) {
        $('#screen').innerHTML = backdrop(S.cur) + '<div class="msg">' + esc(text) + '</div>';
    }

    function ytEmbed(u) {
        var m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
        return m ? 'https://www.youtube.com/embed/' + m[1] : '';
    }

    function curEp() {
        var d = S.det; if (!d) return null;
        var sv = (d.episodes || [])[S.srv]; if (!sv) return null;
        return (sv.server_data || [])[S.ep] || null;
    }

    function mountEmbed(url) {
        $('#screen').innerHTML = '<iframe src="' + esc(url) + '" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerpolicy="no-referrer" title="Trình phát"></iframe>';
    }

    function mountHls(url, fallback) {
        var s = $('#screen');
        s.innerHTML = '<video controls playsinline preload="metadata"></video>';
        var v = s.firstChild, po = (S.cur.poster2 || S.cur.poster);
        if (po) v.poster = po;
        function fail() {
            if (fallback) { S.mode = 'embed'; playCurrent(true); }
            else screenMsg('Không phát được nguồn HLS. Đang chuyển sang server hoặc tập khác.');
        }
        if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = url;
            v.addEventListener('error', fail, { once: true });
        } else if (window.Hls && window.Hls.isSupported()) {
            hls = new window.Hls();
            hls.loadSource(url);
            hls.attachMedia(v);
            hls.on(window.Hls.Events.ERROR, function (_, d) { if (d && d.fatal) fail(); });
        } else {
            fail();
            return;
        }
        var p = v.play();
        if (p && p.catch) p.catch(function () { });
    }

    function paintModes(ep) {
        var h = '';
        if (ep && ep.link_m3u8 && ep.link_embed) {
            h = '<button class="chip" data-mode="hls" aria-pressed="' + (S.mode === 'hls') + '">Trình phát chính</button>' +
                '<button class="chip" data-mode="embed" aria-pressed="' + (S.mode === 'embed') + '">Dự phòng</button>';
        }
        $('#m-modes').innerHTML = h;
    }

    function playCurrent(keepMode) {
        destroyPlayer();
        var d = S.det, ep = curEp();
        if (!ep) {
            var tr = d && d.movie && ytEmbed(d.movie.trailer_url);
            if (tr) { mountEmbed(tr); $('#m-now').textContent = 'Trailer'; paintModes(null); return; }
            screenMsg('Phim này chưa có tập để phát.');
            $('#m-now').textContent = '';
            paintModes(null);
            return;
        }
        var m3 = safeUrl(ep.link_m3u8), em = safeUrl(ep.link_embed);
        if (!keepMode) S.mode = m3 ? 'hls' : 'embed';
        if (S.mode === 'hls' && !m3) S.mode = 'embed';
        if (S.mode === 'embed' && !em && m3) S.mode = 'hls';
        var sv = d.episodes[S.srv];
        $('#m-now').textContent = (ep.name ? 'Tập ' + ep.name.replace(/^tập\s*/i, '') : '') + (sv && sv.server_name ? ' · ' + sv.server_name : '');
        paintModes({ link_m3u8: m3, link_embed: em });
        paintEps();
        if (S.mode === 'hls') mountHls(m3, !!em);
        else if (em) mountEmbed(em);
        else screenMsg('Tập này chưa có nguồn phát.');
    }

    function paintEps() {
        var d = S.det, box = $('#m-eps');
        var sv = (d && d.episodes) || [];
        if (!sv.length) { box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        var h = '';
        if (sv.length > 1) {
            h += '<div class="lbl">Máy chủ</div><div class="srvs">' +
                sv.map(function (s, i) { return '<button class="chip" data-srv="' + i + '" aria-pressed="' + (i === S.srv) + '">' + esc(s.server_name || ('Server ' + (i + 1))) + '</button>'; }).join('') +
                '</div>';
        }
        var data = (sv[S.srv] && sv[S.srv].server_data) || [];
        h += '<div class="lbl">Danh sách tập · ' + data.length + '</div><div class="eps">' +
            data.map(function (e, i) { return '<button class="ep" data-ep="' + i + '" aria-pressed="' + (i === S.ep) + '">' + esc(e.name || (i + 1)) + '</button>'; }).join('') +
            '</div>';
        box.innerHTML = h;
    }

    function paintListBtn() {
        var on = inList(S.cur.slug);
        $('#m-list').innerHTML = ic(on ? 'check' : 'plus') + (on ? 'Trong danh sách' : 'Danh sách của tôi');
    }

    function paintInfo() {
        var it = S.cur, d = S.det, m = (d && d.movie) || {};
        var time = m.time ? (/^\d+$/.test(m.time) ? m.time + ' phút' : m.time) : '';
        var bits = [
            m.quality && '<span class="tag">' + esc(m.quality) + '</span>',
            m.lang && '<span>' + esc(m.lang) + '</span>',
            (m.year || it.year) && '<span>' + esc(m.year || it.year) + '</span>',
            time && '<span>' + esc(time) + '</span>',
            m.episode_current && '<span>' + esc(m.episode_current) + '</span>',
            it.rating > 0 && '<span class="tag">TMDB ' + it.rating.toFixed(1) + '</span>'
        ].filter(Boolean);
        $('#m-meta').innerHTML = bits.join('');
        $('#m-title').textContent = m.name || it.name;
        $('#m-orig').textContent = m.origin_name || it.origin || '';
        $('#m-syn').textContent = d ? (plain(m.content) || 'Chưa có mô tả.') : 'Đang tải thông tin phim…';
        function join(a, f) { return (a || []).map(f || function (x) { return x; }).filter(Boolean).join(', '); }
        var rows = [
            ['Đạo diễn', join(m.director)],
            ['Diễn viên', join((m.actor || []).slice(0, 8))],
            ['Thể loại', join(m.category, function (c) { return c.name; })],
            ['Quốc gia', join(m.country, function (c) { return c.name; })]
        ].filter(function (r) { return r[1]; });
        $('#m-side').innerHTML = rows.map(function (r) { return '<div><small>' + r[0] + '</small>' + esc(r[1]) + '</div>'; }).join('');
        paintListBtn();
    }

    function openFilm(slug) {
        var it = S.by[slug] || getList().filter(function (x) { return x.slug === slug; })[0];
        if (!it) return;
        lastFocus = document.activeElement;
        S.cur = it; S.det = null; S.srv = 0; S.ep = 0; S.mode = 'hls';
        destroyPlayer();
        screenMsg('Đang tải phim…');
        $('#m-now').textContent = '';
        $('#m-modes').innerHTML = '';
        $('#m-eps').hidden = true;
        paintInfo();
        var m = $('#modal');
        m.hidden = false;
        m.scrollTop = 0;
        document.body.style.overflow = 'hidden';
        $('#m-close').focus();
        detail(slug).then(function (d) {
            if (!S.cur || S.cur.slug !== slug) return;
            S.det = d;
            paintInfo();
            var sv = d.episodes || [];
            for (var i = 0; i < sv.length; i++) {
                if ((sv[i].server_data || []).length) { S.srv = i; break; }
            }
            playCurrent();
            paintEps();
        }).catch(function (e) {
            if (!S.cur || S.cur.slug !== slug) return;
            screenMsg('Không tải được phim: ' + ((e && e.message) || 'lỗi mạng') + '. Hãy thử lại sau.');
            $('#m-syn').textContent = '';
        });
    }

    function closeFilm() {
        destroyPlayer();
        S.cur = null; S.det = null;
        $('#modal').hidden = true;
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    $('#m-close').onclick = closeFilm;
    $('#m-list').onclick = function () { if (S.cur) toggleList(S.cur.slug); };
    document.addEventListener('keydown', function (e) {
        if (!$('#modal').hidden && e.key === 'Escape') closeFilm();
    });

    /*  SỰ KIỆN TÌM KIẾM VÀ DROPDOWN BỘ LỌC  */
    var searchTimer = null;
    $('#q').addEventListener('input', function (e) {
        var val = e.target.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            if (val) {
                S.filterType = 'search';
                S.searchKey = val;
                fetchMovies(1, true);
            } else {
                S.filterType = 'latest';
                fetchMovies(1, true);
            }
        }, 450);
    });

    $('#sel-genre').addEventListener('change', function (e) {
        var val = e.target.value;
        if (val) {
            S.filterType = 'genre';
            S.filterVal = val;
        } else {
            S.filterType = 'latest';
        }
        fetchMovies(1, true);
    });

    $('#sel-country').addEventListener('change', function (e) {
        var val = e.target.value;
        if (val) {
            S.filterType = 'country';
            S.filterVal = val;
        } else {
            S.filterType = 'latest';
        }
        fetchMovies(1, true);
    });

    $('#sel-year').addEventListener('change', function (e) {
        var val = e.target.value;
        if (val) {
            S.filterType = 'year';
            S.filterVal = val;
        } else {
            S.filterType = 'latest';
        }
        fetchMovies(1, true);
    });

    $('#more-btn').onclick = function () {
        fetchMovies(S.page + 1, false);
    };

    $('#h-search').addEventListener('click', function () {
        setTimeout(function () { $('#q').focus({ preventScroll: true }); }, 500);
    });

    document.addEventListener('click', function (e) {
        var t = e.target.closest('[data-list]');
        if (t) { toggleList(t.dataset.list); return; }
        t = e.target.closest('[data-scroll]');
        if (t) {
            var tr = document.getElementById(t.dataset.scroll);
            tr.scrollBy({ left: tr.clientWidth * .8 * (+t.dataset.dir), behavior: 'smooth' });
            return;
        }
        t = e.target.closest('[data-chip]');
        if (t) {
            S.filterType = t.dataset.chip;
            renderChips();
            fetchMovies(1, true);
            return;
        }
        t = e.target.closest('[data-retry]');
        if (t) { fetchMovies(1, true); return; }
        t = e.target.closest('#modal [data-srv]');
        if (t) {
            S.srv = +t.dataset.srv;
            var n = ((S.det.episodes[S.srv] || {}).server_data || []).length;
            if (S.ep >= n) S.ep = 0;
            playCurrent();
            return;
        }
        t = e.target.closest('#modal [data-ep]');
        if (t) { S.ep = +t.dataset.ep; playCurrent(); return; }
        t = e.target.closest('#modal [data-mode]');
        if (t) { S.mode = t.dataset.mode; playCurrent(true); return; }
        if (e.target.closest('#modal')) return;
        t = e.target.closest('[data-slug]');
        if (t) { openFilm(t.dataset.slug); }
    });

    function onScroll() { $('#hdr').classList.toggle('solid', window.scrollY > 40); }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Khởi động
    renderChips();
    initFilters();
    fetchMovies(1, true);
})();