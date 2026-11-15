using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;

namespace MaintARBackend.Controllers
{
    // Выгрузка истории осмотров и журнала работ в CSV (открывается в Excel: UTF-8 с BOM, разделитель «;»).
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "EmailVerified")]
    public class ExportController : ControllerBase
    {
        private readonly AppDbContext _db;

        public ExportController(AppDbContext db)
        {
            _db = db;
        }

        // Осмотры: одна строка на находку ИИ. mine=true — только свои, equipmentId — по одному оборудованию.
        [HttpGet("inspections")]
        public async Task<IActionResult> Inspections([FromQuery] bool mine = false, [FromQuery] int? equipmentId = null)
        {
            var query = _db.Inspections.AsNoTracking()
                .Include(i => i.Equipment)
                .Include(i => i.User)
                .Include(i => i.Findings).ThenInclude(f => f.Component)
                .Include(i => i.Findings).ThenInclude(f => f.DefectType)
                .AsQueryable();
            if (mine)
            {
                var userId = GetUserId();
                query = query.Where(i => i.UserId == userId);
            }
            if (equipmentId != null)
            {
                query = query.Where(i => i.EquipmentId == equipmentId);
            }

            var items = await query.OrderByDescending(i => i.CreatedAt).ToListAsync();

            var rows = new List<string[]>
            {
                new[] { "Дата", "Код оборудования", "Оборудование", "Инженер", "Статус осмотра", "Узел",
                        "Результат", "Дефект", "Уверенность, %", "Пояснение", "Рекомендация", "Фото" }
            };
            var baseUrl = $"{Request.Scheme}://{Request.Host}";
            foreach (var i in items)
            {
                var photo = string.IsNullOrEmpty(i.PhotoPath) ? "" : baseUrl + i.PhotoPath;
                var head = new[] { Date(i.CreatedAt), i.Equipment.Code, i.Equipment.Name, i.User.UserName, Status(i.Status) };
                if (i.Findings.Count == 0)
                {
                    rows.Add(head.Concat(new[] { "", "", "", "", "", "", photo }).ToArray());
                    continue;
                }
                foreach (var f in i.Findings)
                {
                    rows.Add(head.Concat(new[]
                    {
                        f.Component.Name,
                        Category(f.Category),
                        f.DefectType?.Name ?? "",
                        f.Confidence == null ? "" : Math.Round(f.Confidence.Value * 100).ToString(CultureInfo.InvariantCulture),
                        f.Explanation ?? "",
                        f.Recommendation ?? "",
                        photo
                    }).ToArray());
                }
            }

            return Csv(rows, "osmotry");
        }

        // Журнал работ. mine=true — только свои записи, equipmentId — по одному оборудованию.
        [HttpGet("maintenance")]
        public async Task<IActionResult> Maintenance([FromQuery] bool mine = false, [FromQuery] int? equipmentId = null)
        {
            var query = _db.MaintenanceRecords.AsNoTracking()
                .Include(m => m.User)
                .Include(m => m.Component).ThenInclude(c => c.Equipment)
                .AsQueryable();
            if (mine)
            {
                var userId = GetUserId();
                query = query.Where(m => m.UserId == userId);
            }
            if (equipmentId != null)
            {
                query = query.Where(m => m.Component.EquipmentId == equipmentId);
            }

            var items = await query.OrderByDescending(m => m.Date).ToListAsync();

            var rows = new List<string[]>
            {
                new[] { "Дата", "Код оборудования", "Оборудование", "Узел", "Работа", "Комментарий", "Инженер" }
            };
            foreach (var m in items)
            {
                rows.Add(new[]
                {
                    Date(m.Date), m.Component.Equipment.Code, m.Component.Equipment.Name, m.Component.Name,
                    Work(m.Type), m.Comment ?? "", m.User.UserName
                });
            }

            return Csv(rows, "zhurnal-rabot");
        }

        private FileContentResult Csv(List<string[]> rows, string name)
        {
            var sb = new StringBuilder();
            foreach (var r in rows)
            {
                sb.Append(string.Join(';', r.Select(Escape))).Append("\r\n");
            }
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
            return File(bytes, "text/csv; charset=utf-8", $"maintar-{name}-{DateTime.Now:yyyy-MM-dd}.csv");
        }

        private static string Escape(string v)
        {
            v ??= "";
            return v.IndexOfAny(new[] { ';', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
        }

        // Даты в базе в UTC — в файле показываем местное время сервера.
        private static string Date(DateTime d) =>
            (d.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : d)
                .ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);

        private static string Status(InspectionStatus s) => s switch
        {
            InspectionStatus.Completed => "Завершён",
            InspectionStatus.Failed => "Анализ не выполнен",
            _ => "В обработке"
        };

        private static string Category(FindingCategory c) => c switch
        {
            FindingCategory.PossibleDefect => "Возможный дефект",
            FindingCategory.CheckRecommended => "Рекомендуется проверка",
            _ => "Видимых проблем не обнаружено"
        };

        private static string Work(MaintenanceType t) => t switch
        {
            MaintenanceType.Checked => "Проверил",
            MaintenanceType.Serviced => "Обслужил",
            MaintenanceType.Replaced => "Заменил",
            _ => "Заметка"
        };

        private int GetUserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    }
}
