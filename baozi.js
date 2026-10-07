// Derived from venera-app/venera-configs/baozi.js (version 1.1.6).
// Supplement: main-site entry, manual web verification and image CDN fallback.
// See NOTICE.md for upstream attribution and licensing information.

class Baozi extends ComicSource {
  // 此漫画源的名称
  name = "包子漫画（主站）";

  // 唯一标识符
  key = "baozi_www";

  version = "1.2.3";

  minAppVersion = "2.4.2";

  // 独立补充源，保留独立 key，更新地址指向本仓库。
  // 搜索、详情和首个章节入口固定主站；允许页面提供的图片及同章分页服务器。
  url = "https://raw.githubusercontent.com/lizhenghe616/venera-baozi-source/main/baozi.js";

  settings = {
    image_server: {
      title: "图片线路",
      type: "select",
      options: [
        { value: "auto", text: "自动切换（推荐）" },
        { value: "as.baozimh.com", text: "线路一" },
        { value: "as-rsa1-usla.baozicdn.com", text: "线路二" },
        { value: "original", text: "网页原始线路" },
      ],
      default: "auto",
    },
    language: {
      title: "简繁切换",
      type: "select",
      options: [
        { value: "cn", text: "简体" },
        { value: "tw", text: "繁體" },
      ],
      default: "cn",
    },
  };

  // 语言只用于主站分类参数，不改变访问域名。
  get lang() {
    return this.loadSetting("language") || this.settings.language.default;
  }
  get baseUrl() {
    return "https://www.baozimh.com";
  }

  // 保守解析链接；QuickJS 环境无需依赖浏览器 URL 对象。
  mainUrl(value, base = this.baseUrl + "/") {
    if (typeof value !== "string" || !value.trim()) return null;
    let link = value.trim();
    if (/[\u0000-\u0020\u007f\\]/.test(link)) return null;
    if (link.startsWith("//")) link = "https:" + link;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(link)) {
      if (link.startsWith("/")) link = this.baseUrl + link;
      else if (link.startsWith("?")) link = base.split(/[?#]/)[0] + link;
      else if (link.startsWith("#")) link = base.split("#")[0] + link;
      else link = base.split(/[?#]/)[0].replace(/[^/]*$/, "") + link;
    }
    // 精确匹配主机；拒绝其他子域名、用户信息、非 HTTPS 和其他端口。
    const match = link.match(/^https:\/\/www\.baozimh\.com(?::443)?(?=\/|\?|#|$)(.*)$/i);
    if (!match) return null;
    let path = match[1].split("#")[0];
    if (!path.startsWith("/")) path = "/" + path;
    return this.baseUrl + path;
  }

  // 保留主站实际提供的 HTTP/HTTPS 资源，不手动替换 CDN 域名或图片质量路径。
  resourceUrl(value, base = this.baseUrl + "/") {
    if (typeof value !== "string" || !value.trim()) return null;
    let link = value.trim();
    if (/[\u0000-\u0020\u007f\\]/.test(link)) return null;
    if (link.startsWith("//")) link = "https:" + link;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(link)) {
      const origin = base.match(/^https?:\/\/[^/?#]+/i);
      if (!origin) return null;
      if (link.startsWith("/")) link = origin[0] + link;
      else if (link.startsWith("?")) link = base.split(/[?#]/)[0] + link;
      else if (link.startsWith("#")) link = base.split("#")[0] + link;
      else link = base.split(/[?#]/)[0].replace(/[^/]*$/, "") + link;
    }
    // 拒绝非网页协议及含用户名/密码的地址；不限定图片主机。
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?(?=\/|\?|#|$)/i.test(link)) return null;
    return link.split("#")[0];
  }

  requireResourceUrl(value, base) {
    const url = this.resourceUrl(value, base);
    if (!url) throw "网页返回了无效的图片或分页地址。";
    return url;
  }

  async getReadingPage(url) {
    const res = await Network.get(this.requireResourceUrl(url));
    return this.checkResponse(res);
  }

  imageLoadingConfig(value) {
    const original = this.requireResourceUrl(value);
    const setting = this.loadSetting("image_server") || "auto";
    const match = original.match(/^https?:\/\/([^/?#]+)(\/(?:w\d+\/)?[a-z]comic\/.*)$/i);
    const candidates = [];
    const add = (url) => { if (!candidates.includes(url)) candidates.push(url); };
    // 只切换包子漫画 CDN 的漫画正文路径；不改封面、其他站点或章节页地址。
    const isBaoziCdn = match && /(?:^|\.)(?:baozicdn\.com|bzcdn\.net|baozimh\.com)$/i.test(match[1]);
    if (isBaoziCdn && setting !== "original") {
      const known = ["as.baozimh.com", "as-rsa1-usla.baozicdn.com"];
      if (known.includes(setting)) add("https://" + setting + match[2]);
      for (const domain of known) add("https://" + domain + match[2]);
    }
    add(original);
    const makeConfig = (index) => {
      const config = {
        url: candidates[index],
        headers: {
          Referer: this.baseUrl + "/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        },
      };
      if (index + 1 < candidates.length) {
        config.onLoadFailed = () => makeConfig(index + 1);
      }
      return config;
    };
    return makeConfig(0);
  }

  requireMainUrl(value, base) {
    const url = this.mainUrl(value, base);
    if (!url) throw "漫画入口必须来自 www.baozimh.com。";
    return url;
  }

  checkResponse(res) {
    if (res.status === 403 && typeof res.body === "string") {
      let error;
      try { error = JSON.parse(res.body).error; } catch (_) {}
      if (error === "challenge_required") {
        throw "主站要求网页验证：请进入漫画源的登录页面，选择使用网页登录，完成验证后重新搜索。";
      }
    }
    return res;
  }

  async getPage(url) {
    const res = await Network.get(this.requireMainUrl(url));
    return this.checkResponse(res);
  }

  async postPage(url, headers, data) {
    const res = await Network.post(this.requireMainUrl(url), headers, data, { maskDataInLog: true });
    return this.checkResponse(res);
  }

  comicId(value) {
    const url = this.requireMainUrl(value);
    const match = url.match(/^https:\/\/www\.baozimh\.com\/comic\/([^/?#]+)(?:[?#]|$)/);
    if (!match) throw "主站漫画链接格式不受支持。";
    return match[1];
  }

  /// 账号
  /// 设置为null禁用账号功能
  account = {
    // 用户手动完成主站验证；Venera 在成功后将 WebView Cookie 保存到请求 CookieJar。
    // 网页验证不等同于网站账号登录，且脚本无法限制 WebView 的子资源或 HTTP 跳转。
    loginWithWebview: {
      url: "https://www.baozimh.com/",
      checkStatus: (url, title) => {
        // 不将相对地址、验证页、错误页或其他域名误判为完成验证。
        if (typeof url !== "string" || !/^https:\/\/www\.baozimh\.com(?::443)?(?:[/?#]|$)/i.test(url)) return false;
        const main = this.mainUrl(url);
        if (!main || /\/__gatekeeper_challenge(?:[/?#]|$)/i.test(main)) return false;
        if (typeof title !== "string" || /验证|驗證|安全检查|安全檢查|challenge|verify|verification|access denied|forbidden|just a moment/i.test(title)) return false;
        // 采用保守的页面标题判断；无法识别时保留网页供用户检查。
        return /包子漫[画畫书書]/.test(title);
      },
      onLoginSuccess: () => {
        UI.showMessage("已保存主站网页 Cookie，请返回重新搜索。若仍提示验证，请再次使用网页登录。");
      },
    },
    /// 登录
    /// 返回任意值表示登录成功
    login: async (account, pwd) => {
      let res = await this.postPage(
        `${this.baseUrl}/api/bui/signin`,
        {
          "content-type":
            "multipart/form-data; boundary=----WebKitFormBoundaryFUNUxpOwyUaDop8s",
        },
        '------WebKitFormBoundaryFUNUxpOwyUaDop8s\r\nContent-Disposition: form-data; name="username"\r\n\r\n' +
        account +
        '\r\n------WebKitFormBoundaryFUNUxpOwyUaDop8s\r\nContent-Disposition: form-data; name="password"\r\n\r\n' +
        pwd +
        "\r\n------WebKitFormBoundaryFUNUxpOwyUaDop8s--\r\n"
      );
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let json = JSON.parse(res.body);
      let token = json.data;
      if (typeof token !== "string" || !token.trim()) {
        throw "主站未返回有效登录信息，请使用网页登录或检查账号密码。";
      }
      Network.setCookies(this.baseUrl, [
        new Cookie({
          name: "TSID",
          value: token,
          domain: "www.baozimh.com",
        }),
      ]);
      return "ok";
    },

    // 退出登录时将会调用此函数
    logout: () => {
      Network.deleteCookies(this.baseUrl);
    },

    registerWebsite: "https://www.baozimh.com/user/signup",
  };

  /// 解析漫画列表
  parseComic(e) {
    let url = e.querySelector("a").attributes["href"];
    let id = this.comicId(url);
    let title = e.querySelector("h3").text.trim();
    let cover = this.resourceUrl(e.querySelector("a > amp-img").attributes["src"]) || "";
    let tags = e.querySelectorAll("div.tabs > span").map((e) => e.text.trim());
    let description = e.querySelector("small").text.trim();
    return {
      id: id,
      title: title,
      cover: cover,
      tags: tags,
      description: description,
    };
  }

  parseJsonComic(e) {
    return {
      id: e.comic_id,
      title: e.name,
      subTitle: e.author,
      // 分类接口通常返回封面文件名，沿用包子漫画的封面服务器。
      cover: this.resourceUrl(e.topic_img, "https://static-tw.baozimh.com/cover/") || "",
      tags: e.type_names,
    };
  }

  /// 探索页面
  /// 一个漫画源可以有多个探索页面
  explore = [
    {
      /// 标题
      /// 标题同时用作标识符, 不能重复
      title: "包子漫画（主站）",

      /// singlePageWithMultiPart 或者 multiPageComicList
      type: "singlePageWithMultiPart",

      load: async () => {
        var res = await this.getPage(this.baseUrl);
        if (res.status !== 200) {
          throw "Invalid status code: " + res.status;
        }
        let document = new HtmlDocument(res.body);
        try {
        let parts = document.querySelectorAll("div.index-recommend-items");
        let result = {};
        for (let part of parts) {
          let title = part.querySelector("div.catalog-title").text.trim();
          let comics = part
            .querySelectorAll("div.comics-card")
            .map((e) => this.parseComic(e));
          if (comics.length > 0) {
            result[title] = comics;
          }
        }
        return result;
        } finally {
          document.dispose();
        }
      },
    },
  ];

  /// 分类页面
  /// 一个漫画源只能有一个分类页面, 也可以没有, 设置为null禁用分类页面
  category = {
    /// 标题, 同时为标识符, 不能与其他漫画源的分类页面重复
    title: "包子漫画（主站）",
    parts: [
      {
        name: "类型",

        // fixed 或者 random
        // random用于分类数量相当多时, 随机显示其中一部分
        type: "fixed",

        // 如果类型为random, 需要提供此字段, 表示同时显示的数量
        // randomNumber: 5,

        categories: [
          "全部",
          "恋爱",
          "纯爱",
          "古风",
          "异能",
          "悬疑",
          "剧情",
          "科幻",
          "奇幻",
          "玄幻",
          "穿越",
          "冒险",
          "推理",
          "武侠",
          "格斗",
          "战争",
          "热血",
          "搞笑",
          "大女主",
          "都市",
          "总裁",
          "后宫",
          "日常",
          "韩漫",
          "少年",
          "其它",
        ],

        // category或者search
        // 如果为category, 点击后将进入分类漫画页面, 使用下方的`categoryComics`加载漫画
        // 如果为search, 将进入搜索页面
        itemType: "category",

        // 若提供, 数量需要和`categories`一致, `categoryComics.load`方法将会收到此参数
        categoryParams: [
          "all",
          "lianai",
          "chunai",
          "gufeng",
          "yineng",
          "xuanyi",
          "juqing",
          "kehuan",
          "qihuan",
          "xuanhuan",
          "chuanyue",
          "mouxian",
          "tuili",
          "wuxia",
          "gedou",
          "zhanzheng",
          "rexie",
          "gaoxiao",
          "danuzhu",
          "dushi",
          "zongcai",
          "hougong",
          "richang",
          "hanman",
          "shaonian",
          "qita",
        ],
      },
    ],
    enableRankingPage: false,
  };

  /// 分类漫画页面, 即点击分类标签后进入的页面
  categoryComics = {
    load: async (category, param, options, page) => {
      let res = await this.getPage(
        `${this.baseUrl}/api/bzmhq/amp_comic_list?type=${param}&region=${options[0]}&state=${options[1]}&filter=%2a&page=${page}&limit=36&language=${this.lang}&__amp_source_origin=${this.baseUrl}`
      );
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let maxPage = null;
      let json = JSON.parse(res.body);
      if (!json.next) {
        maxPage = page;
      }
      return {
        comics: json.items.map((e) => this.parseJsonComic(e)),
        maxPage: maxPage,
      };
    },
    // 提供选项
    optionList: [
      {
        options: ["all-全部", "cn-国漫", "jp-日本", "kr-韩国", "en-欧美"],
      },
      {
        options: ["all-全部", "serial-连载中", "pub-已完结"],
      },
    ],
  };

  /// 搜索
  search = {
    load: async (keyword, options, page) => {
      let res = await this.getPage(`${this.baseUrl}/search?q=${encodeURIComponent(keyword)}`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);
      try {
      let comics = document
        .querySelectorAll("div.comics-card")
        .map((e) => this.parseComic(e));
      return {
        comics: comics,
        maxPage: 1,
      };
      } finally {
        document.dispose();
      }
    },

    // 提供选项
    optionList: [],
  };

  /// 收藏
  favorites = {
    /// 是否为多收藏夹
    multiFolder: false,
    /// 添加或者删除收藏
    addOrDelFavorite: async (comicId, folderId, isAdding) => {
      if (!isAdding) {
        let res = await this.postPage(
          `${this.baseUrl}/user/operation_v2?op=del_bookmark&comic_id=${comicId}`
        );
        if (!res.status || res.status >= 400) {
          throw "Invalid status code: " + res.status;
        }
        return "ok";
      } else {
        let res = await this.postPage(
          `${this.baseUrl}/user/operation_v2?op=set_bookmark&comic_id=${comicId}&chapter_slot=0`
        );
        if (!res.status || res.status >= 400) {
          throw "Invalid status code: " + res.status;
        }
        return "ok";
      }
    },
    // 加载收藏夹, 仅当multiFolder为true时有效
    // 当comicId不为null时, 需要同时返回包含该漫画的收藏夹
    loadFolders: null,
    /// 加载漫画
    loadComics: async (page, folder) => {
      let res = await this.getPage(`${this.baseUrl}/user/my_bookshelf`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);
      try {
      const parseComic = (e) => {
        let title = e.querySelector("h4 > a").text.trim();
        let url = e.querySelector("h4 > a").attributes["href"];
        let id = this.comicId(url);
        let author = e
          .querySelector("div.info > ul")
          .children[1].text.split("：")[1]
          .trim();
        let description = e
          .querySelector("div.info > ul")
          .children[4].children[0].text.trim();

        return {
          id: id,
          title: title,
          subTitle: author,
          description: description,
          cover: this.resourceUrl(e.querySelector("amp-img").attributes["src"]) || "",
        };
      }
      let comics = document
        .querySelectorAll("div.bookshelf-items")
        .map((e) => parseComic(e));
      return {
        comics: comics,
        maxPage: 1,
      };
      } finally {
        document.dispose();
      }
    },
  };

  /// 单个漫画相关
  comic = {
    // 加载漫画信息
    loadInfo: async (id) => {
      let res = await this.getPage(`${this.baseUrl}/comic/${encodeURIComponent(id)}`);
      if (res.status !== 200) {
        throw "Invalid status code: " + res.status;
      }
      let document = new HtmlDocument(res.body);
      try {

      let title = document.querySelector("h1.comics-detail__title").text.trim();
      let cover = this.resourceUrl(document.querySelector("div.l-content > div > div > amp-img")
        .attributes["src"]) || "";
      let author = document
        .querySelector("h2.comics-detail__author")
        .text.trim();
      let tags = document
        .querySelectorAll("div.tag-list > span")
        .map((e) => e.text.trim());
      tags = [...tags.filter((e) => e !== "")];
      let updateTime = document
        .querySelector("div.supporting-text > div > span > em")
        ?.text.trim()
        .replace("(", "")
        .replace(")", "");
      if (!updateTime) {
        const getLastChapterText = () => {
          // 合并所有章节容器（处理可能存在多个列表的情况）
          const containers = [
            ...document.querySelectorAll(
              "#chapter-items, #chapters_other_list"
            ),
          ];
          let allChapters = [];
          containers.forEach((container) => {
            const chapters = container.querySelectorAll(".comics-chapters > a");
            allChapters.push(...Array.from(chapters));
          });
          const lastChapter = allChapters[allChapters.length - 1];
          return (
            lastChapter?.querySelector("div > span")?.text.trim() ||
            "暂无更新信息"
          );
        };
        updateTime = getLastChapterText();
      }
      let description = document
        .querySelector("p.comics-detail__desc")
        .text.trim();
      // 章节 ID 使用主站页面的真实链接，不再猜测 App 子域名的路径。
      const chapters = new Map();
      let links = document.querySelectorAll(
        "div#chapter-items > div.comics-chapters > a, div#chapters_other_list > div.comics-chapters > a"
      );
      if (links.length === 0) {
        links = document.querySelectorAll("div.comics-chapters > a").reverse();
      }
      for (const link of links) {
        const chapterUrl = this.requireMainUrl(link.attributes["href"]);
        chapters.set(chapterUrl, link.text.trim());
      }
      let recommend = [];
      for (let c of document.querySelectorAll("div.recommend--item")) {
        if (c.querySelectorAll("div.tag-comic").length > 0) {
          let title = c.querySelector("span").text.trim();
          let cover = this.resourceUrl(c.querySelector("amp-img").attributes["src"]) || "";
          let url = c.querySelector("a").attributes["href"];
          let id = this.comicId(url);
          recommend.push({
            id: id,
            title: title,
            cover: cover,
          });
        }
      }
      // updateTime 将 Y年 M月 D日 转化为 Y-M-D
      let updateDate = updateTime
        .replace(/年/g, "-")
        .replace(/月/g, "-")
        .replace(/日/g, "");

      return new ComicDetails({
        title: title,
        cover: cover,
        description: description,
        tags: {
          作者: [author],
          标签: tags,
        },
        chapters: chapters,
        recommend: recommend,
        updateTime: updateDate,
      });
      } finally {
        document.dispose();
      }
    },
    loadEp: async (comicId, epId) => {
      // loadInfo 保存主站页面的真实 href，主站可使用不同的章节路由。
      // 不猜测固定路径；仍拒绝旧数字 ID、相对 ID 和其他主机。
      if (typeof epId !== "string" || !/^https:\/\/www\.baozimh\.com(?::443)?(?:[/?#]|$)/i.test(epId)) {
        throw "请重新打开主站漫画详情，刷新章节列表后再阅读。";
      }
      let current = this.requireMainUrl(epId);
      const visited = new Set();
      const images = [];
      const seenImages = new Set();
      // 同章身份与分段页码分开比较：query 入口和 0_0.html 都是第一页。
      const partInfo = (url) => {
        const pathMatch = url.match(/\/comic\/chapter\/([^/?]+)\/(\d+)_(\d+)(?:_(\d+))?\.html(?:[?#]|$)/);
        if (pathMatch) return {
          key: pathMatch[1] + "/" + Number(pathMatch[2]) + "_" + Number(pathMatch[3]),
          page: pathMatch[4] ? Number(pathMatch[4]) : 1,
        };
        const comicMatch = url.match(/\/comic\/chapter\/([^/?]+?)(?:\.html)?\?/);
        const comicParam = url.match(/[?&]comic_id=([^&#]+)(?:&|$)/);
        const section = url.match(/[?&]section_slot=(\d+)(?:&|$)/);
        const chapter = url.match(/[?&]chapter_slot=(\d+)(?:&|$)/);
        const slug = comicMatch ? comicMatch[1] : comicParam ? comicParam[1] : null;
        return slug && section && chapter ? {
          key: slug + "/" + Number(section[1]) + "_" + Number(chapter[1]),
          page: 1,
        } : null;
      };
      const originalPart = partInfo(current);
      while (current) {
        if (visited.has(current) || visited.size >= 100) {
          throw "主站章节分页出现循环或超过安全上限，请在浏览器查看。";
        }
        visited.add(current);
        const res = await this.getReadingPage(current);
        if (res.status !== 200) throw "Invalid status code: " + res.status;
        const doc = new HtmlDocument(res.body);
        let next = null;
        let nextPage = Infinity;
        const currentPart = partInfo(current);
        try {
          // 网页版常用 amp-img；兼容普通 img，但仅提取正文区域。
          const nodes = doc.querySelectorAll(".comic-contain amp-img, .comic-contain img");
          for (const node of nodes) {
            const raw = node.attributes["data-src"] || node.attributes["src"];
            if (!raw) continue;
            const image = this.requireResourceUrl(raw, current);
            if (!seenImages.has(image)) {
              seenImages.add(image);
              images.push(image);
            }
          }
          for (const link of doc.querySelectorAll("div.next_chapter a, a#next-chapter")) {
            const href = link.attributes["href"];
            if (!href) continue;
            const candidate = this.resourceUrl(href, current);
            const isPage = /下一[页頁]/.test(link.text || "");
            if (!candidate) {
              if (isPage) throw "主站返回了无效的下一页地址。";
              continue;
            }
            const candidatePart = partInfo(candidate);
            const sameChapter = originalPart && candidatePart && candidatePart.key === originalPart.key;
            if (sameChapter) {
              // 忽略第一页、上一页、当前页和已访问链接，只选最靠前的后续页。
              if (currentPart && candidatePart.page > currentPart.page &&
                  candidatePart.page < nextPage && !visited.has(candidate)) {
                next = candidate;
                nextPage = candidatePart.page;
              }
              continue;
            }
            if (isPage) throw "主站分页链接无法确认属于当前章节，已停止加载。";
          }
        } finally {
          doc.dispose();
        }
        current = next;
      }
      if (images.length === 0) {
        throw "主站没有返回可用图片，可能需要网页验证或页面结构已变化。";
      }
      return { images };
    },
    onImageLoad: (url) => this.imageLoadingConfig(url),
    onThumbnailLoad: (url) => {
      // Venera 仍会加载空封面。复用主站首页响应生成透明占位图，避免反复抛错。
      // 只在网页没有封面时使用占位图；正常 CDN 封面直接加载。
      if (url === "" || url == null) {
        return {
          url: this.baseUrl + "/",
          onResponse: () => Convert.decodeBase64(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
          ),
        };
      }
      return { url: this.requireResourceUrl(url), headers: { Referer: this.baseUrl + "/" } };
    },
  };
}
