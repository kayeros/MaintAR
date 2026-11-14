# Фото оборудования в демо-базе

Фото загружены через `POST api/Equipment/{id}/photo` и лежат на сервере в `wwwroot/uploads/equipment`.
Все снимки взяты с Wikimedia Commons под свободными лицензиями. Подготовка снимков:
- двигатель и трансформатор обрезаны до 4:3 и уменьшены до 1280×960 px (JPEG 85);
- задвижку обрезать до 4:3 нельзя: снимок вертикальный, агрегат высокий. Поэтому она целиком стоит по центру, а по бокам размытый фон того же снимка.

| Оборудование | Код | Что на фото | Файл на Commons | Автор | Лицензия |
|---|---|---|---|---|---|
| Электродвигатель насоса №1 (АИР 132 M4) | MOTOR-001 | общепромышленный асинхронный двигатель на лапах: рёбра корпуса, кожух вентилятора, клеммная коробка | [Induction motor.JPG](https://commons.wikimedia.org/wiki/File:Induction_motor.JPG) | ZngZng | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Задвижка на линии подачи (30с41нж DN100) | VALVE-001 | фланцевая клиновая задвижка с маховиком, целиком | [Absperrventil - Rurberg.jpg](https://commons.wikimedia.org/wiki/File:Absperrventil_-_Rurberg.jpg) | Llez | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| Силовой трансформатор ТП-3 (ТМГ-400/10) | TRANS-001 | герметичный масляный трансформатор 400 кВА с гофробаком и вводами сверху | [Trafo-400kwa hg.jpg](https://commons.wikimedia.org/wiki/File:Trafo-400kwa_hg.jpg) | Hannes Grobe | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |

Это фото того же типа оборудования, а не конкретных агрегатов. Фото конкретного агрегата инженер может переснять в карточке кнопкой «Переснять».
