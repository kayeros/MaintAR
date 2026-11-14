using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;

namespace MaintARBackend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "EmailVerified")]
    public class EquipmentController : ControllerBase
    {
        private const long MaxPhotoSize = 10 * 1024 * 1024;

        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _env;

        public EquipmentController(AppDbContext db, IWebHostEnvironment env)
        {
            _db = db;
            _env = env;
        }

        // Фото оборудования для карточки: сохраняется в wwwroot/uploads/equipment, путь пишется в PhotoPath.
        [HttpPost("{id:int}/photo")]
        [RequestSizeLimit(MaxPhotoSize + 1024 * 1024)]
        public async Task<IActionResult> UploadPhoto(int id, IFormFile photo)
        {
            if (photo == null || photo.Length == 0 || photo.Length > MaxPhotoSize)
            {
                return BadRequest("Photo must be between 1 byte and 10 MB");
            }

            if (!photo.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("File must be an image");
            }

            var equipment = await _db.Equipment.FirstOrDefaultAsync(e => e.Id == id);
            if (equipment == null)
            {
                return NotFound("Equipment not found");
            }

            var root = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            var dir = Path.Combine(root, "uploads", "equipment");
            Directory.CreateDirectory(dir);
            var fileName = $"{id}_{DateTime.UtcNow:yyyyMMddHHmmss}.jpg";
            await using (var stream = System.IO.File.Create(Path.Combine(dir, fileName)))
            {
                await photo.CopyToAsync(stream);
            }

            // Старое фото больше не нужно.
            if (!string.IsNullOrEmpty(equipment.PhotoPath) && equipment.PhotoPath.StartsWith("/uploads/equipment/"))
            {
                var old = Path.Combine(dir, Path.GetFileName(equipment.PhotoPath));
                if (System.IO.File.Exists(old)) System.IO.File.Delete(old);
            }

            equipment.PhotoPath = $"/uploads/equipment/{fileName}";
            await _db.SaveChangesAsync();

            return Ok(new { PhotoUrl = equipment.PhotoPath });
        }

        // Список всего оборудования для главного экрана. search — по названию, коду, серийному номеру или модели.
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] string? search)
        {
            var query = _db.Equipment.AsNoTracking();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                query = query.Where(e => e.Name.Contains(s) || e.Code.Contains(s)
                                         || e.SerialNumber.Contains(s) || e.Model.Contains(s));
            }

            var items = await query
                .OrderBy(e => e.Name)
                .Select(e => new
                {
                    e.Id,
                    e.Code,
                    e.SerialNumber,
                    e.Name,
                    e.Model,
                    e.Manufacturer,
                    Type = e.EquipmentType.Name,
                    e.Location,
                    e.PhotoPath,
                    Last = e.Inspections
                        .Where(i => i.Status == InspectionStatus.Completed)
                        .OrderByDescending(i => i.CreatedAt)
                        .Select(i => new
                        {
                            i.CreatedAt,
                            Defects = i.Findings.Count(f => f.Category != FindingCategory.NoVisibleProblems)
                        })
                        .FirstOrDefault()
                })
                .ToListAsync();

            var result = items.Select(e => new EquipmentListItemDto
            {
                Id = e.Id,
                Code = e.Code,
                SerialNumber = e.SerialNumber,
                Name = e.Name,
                Model = e.Model,
                Manufacturer = e.Manufacturer,
                Type = e.Type,
                Location = e.Location,
                PhotoUrl = e.PhotoPath,
                Status = e.Last == null ? EquipmentReportStatus.NotInspected
                    : e.Last.Defects > 0 ? EquipmentReportStatus.HasDefects : EquipmentReportStatus.Ok,
                LastInspectionDate = e.Last?.CreatedAt,
                DefectsCount = e.Last?.Defects ?? 0
            }).ToList();

            return Ok(result);
        }

        // Карточка оборудования: паспорт, узлы, возможные дефекты и результат последнего осмотра.
        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById(int id)
        {
            var equipment = await _db.Equipment
                .AsNoTracking()
                .Include(e => e.EquipmentType).ThenInclude(t => t.DefectTypes)
                .Include(e => e.Components)
                .FirstOrDefaultAsync(e => e.Id == id);

            if (equipment == null)
            {
                return NotFound("Equipment not found");
            }

            return Ok(new EquipmentDetailsDto
            {
                Id = equipment.Id,
                Code = equipment.Code,
                SerialNumber = equipment.SerialNumber,
                Name = equipment.Name,
                Model = equipment.Model,
                Manufacturer = equipment.Manufacturer,
                Type = equipment.EquipmentType.Name,
                Location = equipment.Location,
                Description = equipment.Description,
                PhotoUrl = equipment.PhotoPath,
                InstalledAt = equipment.InstalledAt,
                Components = equipment.Components
                    .OrderBy(c => c.Id)
                    .Select(c => new ComponentInfoDto
                    {
                        Id = c.Id,
                        Name = c.Name,
                        ServiceLifeMonths = c.ServiceLifeMonths,
                        InstalledAt = c.InstalledAt,
                        LastReplacedAt = c.LastReplacedAt
                    }).ToList(),
                DefectTypes = equipment.EquipmentType.DefectTypes
                    .OrderBy(d => d.Id)
                    .Select(d => new DefectTypeInfoDto { Code = d.Code, Name = d.Name, Description = d.Description })
                    .ToList(),
                Report = await BuildReportAsync(equipment)
            });
        }

        // value — строка из QR-кода, серийный номер или маркировка. Ищем по Code или SerialNumber.
        [HttpGet("identify")]
        public async Task<IActionResult> Identify([FromQuery] string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return BadRequest("Value is required");
            }

            var normalized = value.Trim();

            var equipment = await _db.Equipment
                .AsNoTracking()
                .Include(e => e.EquipmentType)
                .FirstOrDefaultAsync(e => e.Code == normalized || e.SerialNumber == normalized);

            if (equipment == null)
            {
                return NotFound("Equipment not found");
            }

            return Ok(await BuildReportAsync(equipment));
        }

        // Отчёт по последнему завершённому осмотру: общий для identify и карточки.
        private async Task<EquipmentReportDto> BuildReportAsync(Equipment equipment)
        {
            var info = new EquipmentInfoDto
            {
                Id = equipment.Id,
                Code = equipment.Code,
                SerialNumber = equipment.SerialNumber,
                Name = equipment.Name,
                Model = equipment.Model,
                Manufacturer = equipment.Manufacturer,
                Type = equipment.EquipmentType.Name,
                Location = equipment.Location,
                PhotoUrl = equipment.PhotoPath
            };

            // Берём последний завершённый осмотр вместе с находками.
            var lastInspection = await _db.Inspections
                .AsNoTracking()
                .Where(i => i.EquipmentId == equipment.Id && i.Status == InspectionStatus.Completed)
                .OrderByDescending(i => i.CreatedAt)
                .Include(i => i.Findings).ThenInclude(f => f.Component)
                .Include(i => i.Findings).ThenInclude(f => f.DefectType)
                .FirstOrDefaultAsync();

            if (lastInspection == null)
            {
                return new EquipmentReportDto
                {
                    Status = EquipmentReportStatus.NotInspected,
                    Message = "Оборудование ещё не проверялось",
                    Equipment = info
                };
            }

            var problems = lastInspection.Findings
                .Where(f => f.Category != FindingCategory.NoVisibleProblems)
                .ToList();

            if (problems.Count == 0)
            {
                return new EquipmentReportDto
                {
                    Status = EquipmentReportStatus.Ok,
                    Message = "Всё в порядке, дефектов не обнаружено",
                    Equipment = info,
                    LastInspectionDate = lastInspection.CreatedAt
                };
            }

            var defects = problems
                .GroupBy(f => f.Component)
                .Select(g => new ComponentDefectsDto
                {
                    ComponentId = g.Key.Id,
                    ComponentName = g.Key.Name,
                    Findings = g.Select(f => new DefectDto
                    {
                        Category = f.Category,
                        DefectCode = f.DefectType?.Code,
                        DefectName = f.DefectType?.Name,
                        DefectDescription = f.DefectType?.Description,
                        Confidence = f.Confidence,
                        Explanation = f.Explanation,
                        Recommendation = f.Recommendation
                    }).ToList()
                })
                .ToList();

            return new EquipmentReportDto
            {
                Status = EquipmentReportStatus.HasDefects,
                Message = $"Обнаружены дефекты в узлах: {defects.Count}",
                Equipment = info,
                LastInspectionDate = lastInspection.CreatedAt,
                Defects = defects
            };
        }
    }
}
