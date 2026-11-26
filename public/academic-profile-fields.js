(() => {
  const descendants = {
    institution: ['faculty', 'department', 'courseOfStudy'],
    faculty: ['department', 'courseOfStudy'],
    department: ['courseOfStudy']
  };

  function sync(fields) {
    fields.faculty.disabled = !fields.institution.value.trim();
    fields.department.disabled = fields.faculty.disabled || !fields.faculty.value.trim();
    fields.courseOfStudy.disabled = fields.department.disabled || !fields.department.value.trim();
  }

  function resetAfterEdit(fields, field) {
    for (const child of descendants[field] || []) fields[child].value = '';
    sync(fields);
  }

  function populateUniversityOptions(list, universities) {
    list.replaceChildren();
    for (const university of universities) {
      const option = document.createElement('option');
      option.value = university.name;
      option.label = university.type;
      list.appendChild(option);
    }
  }

  function values(fields) {
    return {
      institution: fields.institution.value.trim(),
      faculty: fields.faculty.value.trim(),
      department: fields.department.value.trim(),
      courseOfStudy: fields.courseOfStudy.value.trim()
    };
  }

  window.KlasoraAcademicProfileFields = { populateUniversityOptions, resetAfterEdit, sync, values };
})();
