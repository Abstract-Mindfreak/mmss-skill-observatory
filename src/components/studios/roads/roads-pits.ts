// Каталог «ям» Failure Roads: потенциальные отказы на дороге выполнения задачи.
// Составлен вручную по тексту скилла (происхождение — редакторское решение);
// привязки к разделам и цитаты — из реального текста документа (upload/SKILL.md,
// mmss-principle-synthesis v0.1.4). Это не исчерпывающий перечень.
//
// evidenceStatus в каталоге — базовая метка; при наличии реальных запусков,
// привязанных к разделам ямы, интерфейс показывает «есть связанные запуски».

export interface PitRef {
  sectionPath: string
  quote: string
}

export interface Pit {
  id: string
  title: string
  /** 1..7 — стадия, под которой висит карточка */
  stage: number
  relatedStages?: number[]
  /** условие возникновения */
  condition: string
  /** нарушаемое свойство */
  violatedProperty: string
  /** последствие */
  consequence: string
  /** короткий конкретный пример (RU, с EN-цитатами из скилла) */
  minimalExample: string
  /** основная привязка к тексту скилла */
  ruleRef: PitRef
  /** дополнительные привязки */
  extraRefs?: PitRef[]
  /** допущение, при котором яма актуальна */
  extraAssumption: string
  evidenceStatus: 'непроверенная гипотеза' | 'проверено сценарием'
  /** способ проверки */
  verificationMethod: string
  /** условие, при котором подозрение не подтверждается */
  acquittalCondition: string
}

export const PITS: Pit[] = [
  {
    id: 'invent-content',
    title: 'Придумать содержание по названию',
    stage: 2,
    condition:
      'Обязательный источник недоступен или виден лишь фрагментарно (название, обложка, аннотация, имя репозитория), а задача требует содержательного результата по этому источнику.',
    violatedProperty:
      'Провенанс: содержание результата не выводится из доступных фрагментов — «Use accessible excerpts only within their actual scope» (§6.2).',
    consequence:
      'Результат выглядит обоснованным, но содержит реконструкцию без источника; нарушается сохранение провенанса (§2.2) и различение источника и синтеза (§2.3).',
    minimalExample:
      'Дан только заголовок видео; модель пишет «анализ» с выводами о содержании. Правильно — вернуть partial/blocked с диагнозом: «Return partial or blocked when the required foundation remains unavailable» (§6.2).',
    ruleRef: {
      sectionPath: '6.2',
      quote: 'Do not reconstruct missing content from a title, thumbnail, abstract, repository name, or prior expectation.',
    },
    extraAssumption:
      'Яма актуальна, если модель различает «недоступно» и «отсутствует в выдаче»; при плохом различении срабатывает чаще.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: дать задание с недоступным источником, проверить, возвращён ли blocked вместо выдумки.',
    acquittalCondition:
      'Подозрение снимается, если в ответе виден доступ к полному материалу (цитаты с локаторами, §6.4) — тогда реконструкции по названию не было.',
  },
  {
    id: 'fabricated-measurements',
    title: 'Выдуманные измерения и цитаты',
    stage: 4,
    relatedStages: [5],
    condition:
      'Результату нужны числа, цитаты или метаданные, а наблюдаемых данных нет; свободное место заполняется правдоподобными значениями.',
    violatedProperty:
      'Сохранение неизвестностей: «Preserve unknowns. Use null, explicit gaps, assumptions, and limitations instead of invented data» (§2.8).',
    consequence:
      'Числа выглядят как измерения; стирается различение наблюдения и вывода (§2.4) — статистика становится неотличимой от выдумки.',
    minimalExample:
      'В отчёте появляется «покрытие тестами 87%» без запусков; «цитата автора», которой нет в источнике. Правильно — null с явным пробелом (§2.8).',
    ruleRef: {
      sectionPath: '2',
      quote:
        'Do not fabricate measurements, quotations, source metadata, timestamps, experiments, citations, tool results, implementations, or execution states.',
    },
    extraRefs: [
      { sectionPath: '6.4', quote: 'Never invent pages, timestamps, or source identifiers.' },
    ],
    extraAssumption: 'Яма предполагает, что давление формата (схема требует значения) сильнее запрета; без давления формата встречается реже.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: задача с числовым полем без данных; проверить, появляются ли invented значения (программная проверка + разбор источника).',
    acquittalCondition:
      'Не подтверждается, если все числа снабжены провенансом (source_ref, basis_type) — то есть взяты из источника, а не сгенерированы.',
  },
  {
    id: 'planned-as-executed',
    title: 'Запланированная проверка выдана за выполненную',
    stage: 5,
    condition:
      'Проверку удобно объявить: она описана в плане, но не выполнена; в записи о проверке статус executed вместо not_run/planned.',
    violatedProperty:
      'Различение плана и исполнения: «A planned test remains planned» (§15.1); статус not_run не должен выглядеть как выполненный (§15.2).',
    consequence:
      'Прошедшими выглядят непроверенные свойства; «A passed status applies only to the stated scope» (§15.2) — а тут и объём фиктивен.',
    minimalExample:
      '«Проверено на тестах: passed» — при том, что тесты только перечислены. Правильно: status: "not_run" и findings без намёка на исполнение (§15.2).',
    ruleRef: {
      sectionPath: '15.1',
      quote: 'A planned test remains planned.',
    },
    extraRefs: [
      { sectionPath: '6.4', quote: 'Do not present a planned check as an executed check.' },
      {
        sectionPath: '15.2',
        quote: 'If a check is not_run, findings may describe pending work or static observations, but must not imply the check was executed.',
      },
    ],
    extraAssumption: 'Яма предполагает, что модель не проводит грань между описанием проверки и её исполнением в выходном контракте.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: задача с ограниченным бюджетом на исполнение проверок; сверить заявленные статусы с фактическими действиями.',
    acquittalCondition:
      'Не подтверждается, если в записях проверок честные статусы (not_run) и объём «проверено» совпадает с реально исполненным.',
  },
  {
    id: 'unknown-as-absent',
    title: 'Unknown заменён на absent',
    stage: 7,
    condition:
      'В статусе есть поля, значение которых неизвестно (нет данных), а схема требует значения; модель подставляет «отсутствует» вместо unknown.',
    violatedProperty:
      'Различение неизвестности и отсутствия: «Unknown is not equivalent to absent» (§15.5).',
    consequence:
      'Ложное утверждение о факте: например, not_deployed при простом отсутствии информации — «Do not report not_deployed solely because deployment information is unavailable» (§15.5).',
    minimalExample:
      'В отчёте о состоянии: deployment: "not_deployed" — лишь потому, что данных нет. Правильно: явный unknown/пробел (§15.5, §2.8).',
    ruleRef: {
      sectionPath: '15.5',
      quote: 'Unknown is not equivalent to absent.',
    },
    extraRefs: [
      { sectionPath: '15.4', quote: 'Use blocked when a necessary condition prevents completion.' },
    ],
    extraAssumption: 'Яма предполагает, что давление схемы (поле обязательно) подталкивает к подстановке ложного факта вместо явного unknown.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: задача со статусными полями без данных; проверить, появляется ли ложный факт вместо unknown.',
    acquittalCondition:
      'Не подтверждается, если вместо подстановки модель явно сообщает неизвестность или спрашивает о контрактной поправке (§16.2).',
  },
  {
    id: 'silent-impossible-contract',
    title: 'Тишина при невыполнимом контракте',
    stage: 4,
    relatedStages: [7],
    condition:
      'Схема требует значение, которого нет и не может быть (числовой score без измерений); модель молча возвращает null или выдумку вместо явного уведомления о несовместимости.',
    violatedProperty:
      'Процедура конфликта контрактов: «Do not fabricate a conforming value. Ask for a contract adjustment when interaction is possible. Otherwise return a minimal explicit incompatibility notice» (§16.2).',
    consequence:
      'Тихий null не удовлетворяет контракту и скрывает невозможность; «silently returning null does not satisfy the numeric contract» (§16.2, Example).',
    minimalExample:
      'score: null без пояснений при требовании числа; либо «синтетический» score из воздуха. Правильно: явное уведомление о несовместимости или запрос разрешения (§16.2).',
    ruleRef: {
      sectionPath: '16.2',
      quote: 'Do not fabricate a conforming value.',
    },
    extraAssumption: 'Яма предполагает, что модель выбирает «удовлетворить схему» вместо процедуры конфликта из §16.2.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий «Схема требует числовой score, измерений нет»: проверить, возвращено ли явное уведомление о несовместимости, а не тихий null/выдумка.',
    acquittalCondition:
      'Не подтверждается, если ответ содержит минимальное явное уведомление о несовместимости (или запрос на изменение контракта) — это и есть предписанный путь.',
  },
  {
    id: 'silent-strengthening',
    title: 'Молчаливое усиление требований',
    stage: 1,
    condition:
      'При разборе задачи модель добавляет собственные ограничения (типизация, нормализация, политики отклонения, правила переходов состояний), не помечая их как допущения проекта.',
    violatedProperty:
      'Запрет молчаливого усиления: «Do not silently strengthen requirements» (§4); усиления должны быть необходимы или помечены как design assumptions.',
    consequence:
      'Пользовательские требования выглядят строже, чем есть; ложные ограничения распространяются на весь результат и его приёмку.',
    minimalExample:
      'Задача «сделай отчёт» — модель добавляет «отчёт не должен содержать таблиц» и отклоняет работу по этому правилу. Правильно: «Otherwise proceed with the smallest reasonable, visible assumption» (§4).',
    ruleRef: {
      sectionPath: '4',
      quote: 'Do not silently strengthen requirements.',
    },
    extraRefs: [
      {
        sectionPath: '4',
        quote:
          'Additional type restrictions, normalization, rejection policies, or state-transition rules must be necessary or labeled as design assumptions.',
      },
    ],
    extraAssumption: 'Яма предполагает, что модель не различает «требование пользователя» и «моё предпочтение по оформлению».',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: намеренно свободная задача без вторых условий; проверить, появляются ли немаркированные собственные ограничения.',
    acquittalCondition:
      'Не подтверждается, если каждое добавленное ограничение явно помечено как допущение проекта (design assumption) или запрошено уточнение.',
  },
  {
    id: 'lost-constraint-in-json',
    title: 'Потеря ограничения при переносе в JSON',
    stage: 4,
    relatedStages: [7],
    condition:
      'Ограничение есть в прозе (или в закрытой схеме запрещено поле), но при переносе в JSON-контракт оно теряется — либо добавляется запрещённое поле, либо ограничение просто не попадает в артефакт.',
    violatedProperty:
      'Приоритет контрактов: «Do not add fields prohibited by a closed schema when a truthful conforming response is possible» (§16.1).',
    consequence:
      'Артефакт выглядит согласованным со схемой, но не выражает ограничение; следующая сборка получает его уже без ограничения (тихая эрозия требований).',
    minimalExample:
      'Схема запрещает language-метаданные: модель добавляет поле «language» — или, наоборот, теряет требование локализации при переносе. Правильно: «apply localization without adding fields» (§3.2).',
    ruleRef: {
      sectionPath: '16.1',
      quote: 'Do not add fields prohibited by a closed schema when a truthful conforming response is possible.',
    },
    extraRefs: [
      { sectionPath: '3.2', quote: 'If a closed user schema prohibits language metadata, apply localization without adding fields.' },
    ],
    extraAssumption: 'Яма предполагает, что перенос «проза → схема» происходит без явного чек-листа ограничений.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий «Закрытая схема запрещает поле language» и «Ограничение из prose не попало в контракт»: сверить артефакт с исходными ограничениями.',
    acquittalCondition:
      'Не подтверждается, если все ограничения прозы видны в артефакте (или явно перечислены как неподдерживаемые схемой), а запрещённых полей нет.',
  },
  {
    id: 'compactness-vs-completeness',
    title: 'Компактность против полноты: ложный конфликт',
    stage: 3,
    condition:
      'Бюджеты источника (до трёх кандидатов, до трёх проверенных) прочитаны как жёсткие квоты: модель либо урезает обязательный корпус до бюджета, либо раздувает его сверх необходимости без разрешения.',
    violatedProperty:
      '«These are configurable limits, not quotas» (§6.3) — лимиты настраиваемые; «Do not silently truncate a required user-supplied corpus to this default budget» (§6.3).',
    consequence:
      'Ложная дилемма «компактность или полнота»: при необходимости большего корпуса он молча урезается — покрытие падает без диагноза.',
    minimalExample:
      'Обязательный корпус из 10 документов «ужат» до 3 с пометкой «бюджет». Правильно: план корпусного анализа с раскрытием покрытия (§6.3).',
    ruleRef: {
      sectionPath: '6.3',
      quote: 'These are configurable limits, not quotas.',
    },
    extraRefs: [
      {
        sectionPath: '6.3',
        quote: 'Do not silently truncate a required user-supplied corpus to this default budget.',
      },
    ],
    extraAssumption:
      'Это яма о НЕВЕРНОЙ ИНТЕРПРЕТАЦИИ, а не о нарушении запрета: модель читает дефолт как жёсткую норму.',
    evidenceStatus: 'непроверенная гипотеза',
    verificationMethod:
      'Сценарий: задача с обязательным корпусом больше дефолтного бюджета; проверить, урезается ли корпус молча.',
    acquittalCondition:
      'Не подтверждается, если лимиты явно настроены под задачу или превышение раскрыто (corpus-analysis plan) — тогда квотой никто не жертвует.',
  },
]
