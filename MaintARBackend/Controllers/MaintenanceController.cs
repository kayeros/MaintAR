using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;

namespace MaintARBackend.Controllers
{
    // Временная локальная реализация журнала работ по контракту коллеги (до его пуша MaintenanceController).
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Policy = "EmailVerified")]
    public class MaintenanceController : ControllerBase
    {
        private readonly AppDbContext _db;

        public MaintenanceController(AppDbContext db)
        {
            _db = db;
        }

        public class CreateMaintenanceModel
        {
            public int ComponentId { get; set; }
            public MaintenanceType Type { get; set; }
            public DateTime? Date { get; set; }
            public string? Comment { get; set; }
        }

        public class MaintenanceRecordDto
        {
            public int Id { get; set; }
            public int ComponentId { get; set; }
            public required string ComponentName { get; set; }
            public int EquipmentId { get; set; }
            public required string EquipmentName { get; set; }
            public int UserId { get; set; }
            public required string UserName { get; set; }
            public MaintenanceType Type { get; set; }
            public DateTime Date { get; set; }
            public string? Comment { get; set; }
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateMaintenanceModel model)
        {
            var component = await _db.Components.FirstOrDefaultAsync(c => c.Id == model.ComponentId);
            if (component == null) return NotFound("Component not found");
            if (model.Type == MaintenanceType.Note && string.IsNullOrWhiteSpace(model.Comment))
                return BadRequest("Comment is required for Note");
            var date = model.Date ?? DateTime.UtcNow;
            if (date > DateTime.UtcNow.AddMinutes(5)) return BadRequest("Date cannot be in the future");

            var record = new MaintenanceRecord
            {
                ComponentId = component.Id,
                UserId = UserId(),
                Type = model.Type,
                Date = date,
                Comment = model.Comment?.Trim()
            };
            _db.MaintenanceRecords.Add(record);
            if (model.Type == MaintenanceType.Replaced)
                component.LastReplacedAt = DateOnly.FromDateTime(date);
            await _db.SaveChangesAsync();
            return Ok((await Query().Where(r => r.Id == record.Id).ToListAsync()).Single());
        }

        [HttpGet("equipment/{id:int}")]
        public async Task<IActionResult> ByEquipment(int id) =>
            Ok(await Query().Where(r => r.EquipmentId == id).ToListAsync());

        [HttpGet("component/{id:int}")]
        public async Task<IActionResult> ByComponent(int id) =>
            Ok(await Query().Where(r => r.ComponentId == id).ToListAsync());

        [HttpGet("my")]
        public async Task<IActionResult> My()
        {
            var userId = UserId();
            return Ok(await Query().Where(r => r.UserId == userId).ToListAsync());
        }

        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var userId = UserId();
            var record = await _db.MaintenanceRecords.FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId);
            if (record == null) return NotFound("Record not found");
            _db.MaintenanceRecords.Remove(record);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        private IQueryable<MaintenanceRecordDto> Query() =>
            _db.MaintenanceRecords.AsNoTracking()
                .OrderByDescending(r => r.Date)
                .Select(r => new MaintenanceRecordDto
                {
                    Id = r.Id,
                    ComponentId = r.ComponentId,
                    ComponentName = r.Component.Name,
                    EquipmentId = r.Component.EquipmentId,
                    EquipmentName = r.Component.Equipment.Name,
                    UserId = r.UserId,
                    UserName = r.User.UserName,
                    Type = r.Type,
                    Date = r.Date,
                    Comment = r.Comment
                });

        private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    }
}
