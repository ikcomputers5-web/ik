import React, { useState } from 'react';
import { Printer, Sparkles, Camera, Plus, Trash2 } from 'lucide-react';
import { hasGroqKey, transformShopTextWithGroq } from '../lib/groqClient';

interface CvBuilderStudioProps {
  onOpenGroqModal: () => void;
}

export const CvBuilderStudio: React.FC<CvBuilderStudioProps> = ({ onOpenGroqModal }) => {
  const [template, setTemplate] = useState<'modern' | 'classic'>('modern');
  const [photo, setPhoto] = useState<string>('');
  const [name, setName] = useState<string>('MUHAMMAD IMRAN KHAN');
  const [role, setRole] = useState<string>('Computer Operator / Office Assistant');
  const [fatherName, setFatherName] = useState<string>('Muhammad Aslam Khan');
  const [cnic, setCnic] = useState<string>('35202-1234567-1');
  const [dob, setDob] = useState<string>('15-03-1999');
  const [domicile, setDomicile] = useState<string>('Lahore (Punjab)');
  const [marital, setMarital] = useState<string>('Single');
  const [religion, setReligion] = useState<string>('Islam');
  const [phone, setPhone] = useState<string>('0300-1234567');
  const [email, setEmail] = useState<string>('imran.khan@email.com');
  const [address, setAddress] = useState<string>('Lahore, Punjab, Pakistan');
  const [objective, setObjective] = useState<string>(
    'Hardworking and detail-oriented professional seeking a responsible position where I can utilize my computer composing, administration, and communication skills to contribute to organizational growth.'
  );
  const [education, setEducation] = useState([
    { degree: 'B.A / B.Com', board: 'University of the Punjab', year: '2021', marks: '1st Div' },
    { degree: 'I.Com / F.A', board: 'BISE Lahore', year: '2019', marks: 'A Grade' },
    { degree: 'Matriculation', board: 'BISE Lahore', year: '2017', marks: 'A Grade' },
  ]);
  const [experience, setExperience] = useState([
    '02 Years Experience as Computer Operator & Office Coordinator',
    'Proficient in MS Office (Word, Excel), Urdu Composing, PDF Editing & Printing',
  ]);
  const [skills, setSkills] = useState(
    'MS Word & Excel, Urdu & English Composing, Internet & Email Handling, Customer Dealing, Record Management'
  );
  const [aiPolishing, setAiPolishing] = useState(false);

  const handleAiPolishObjective = async () => {
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    setAiPolishing(true);
    try {
      const res = await transformShopTextWithGroq(
        `Write a crisp 2-sentence CV Career Objective in formal English for job title: "${role}" with skills: "${skills}".`,
        'urdu_to_en'
      );
      if (res) setObjective(res);
    } finally {
      setAiPolishing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTemplate('modern')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
              template === 'modern' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            Modern Corporate CV
          </button>
          <button
            onClick={() => setTemplate('classic')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
              template === 'classic' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            Classic Pakistani Official CV
          </button>
        </div>

        <button
          onClick={() => window.print()}
          className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
        >
          <Printer className="w-4 h-4" /> Print A4 CV / Save PDF
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Editor Form */}
        <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 h-fit no-print">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-sm">Customer CV Details</h3>
            <label className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-400 cursor-pointer flex items-center gap-1">
              <Camera className="w-3.5 h-3.5" /> {photo ? 'Change Photo' : '+ Add Photo'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setPhoto(String(r.result));
                  r.readAsDataURL(f);
                }}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white font-semibold"
            />
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Job Title / Target Role"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={fatherName}
              onChange={(e) => setFatherName(e.target.value)}
              placeholder="Father's Name"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={cnic}
              onChange={(e) => setCnic(e.target.value)}
              placeholder="CNIC No."
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              placeholder="Date of Birth"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={domicile}
              onChange={(e) => setDomicile(e.target.value)}
              placeholder="Domicile"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobile Number"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={marital}
              onChange={(e) => setMarital(e.target.value)}
              placeholder="Marital Status"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
            <input
              value={religion}
              onChange={(e) => setReligion(e.target.value)}
              placeholder="Religion"
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
            />
          </div>

          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Full Residential Address"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
          />

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-300">Career Objective</span>
              <button
                type="button"
                disabled={aiPolishing}
                onClick={handleAiPolishObjective}
                className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
              >
                <Sparkles className="w-3 h-3" />
                {aiPolishing ? 'Polishing...' : 'AI Auto-Write Objective'}
              </button>
            </div>
            <textarea
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white"
            />
          </div>

          {/* Academic Qualification Rows */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Academic Qualification</span>
              <button
                onClick={() =>
                  setEducation((prev) => [
                    ...prev,
                    { degree: '', board: '', year: '', marks: '' },
                  ])
                }
                className="text-xs text-emerald-400 flex items-center gap-0.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
            </div>
            {education.map((ed, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-1 text-xs">
                <input
                  value={ed.degree}
                  onChange={(e) =>
                    setEducation((p) =>
                      p.map((x, i) => (i === idx ? { ...x, degree: e.target.value } : x))
                    )
                  }
                  placeholder="Degree"
                  className="col-span-3 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                />
                <input
                  value={ed.board}
                  onChange={(e) =>
                    setEducation((p) =>
                      p.map((x, i) => (i === idx ? { ...x, board: e.target.value } : x))
                    )
                  }
                  placeholder="Board / Univ"
                  className="col-span-4 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                />
                <input
                  value={ed.year}
                  onChange={(e) =>
                    setEducation((p) =>
                      p.map((x, i) => (i === idx ? { ...x, year: e.target.value } : x))
                    )
                  }
                  placeholder="Year"
                  className="col-span-2 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                />
                <input
                  value={ed.marks}
                  onChange={(e) =>
                    setEducation((p) =>
                      p.map((x, i) => (i === idx ? { ...x, marks: e.target.value } : x))
                    )
                  }
                  placeholder="Div/Grade"
                  className="col-span-2 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                />
                <button
                  onClick={() => setEducation((p) => p.filter((_, i) => i !== idx))}
                  className="col-span-1 text-rose-400 flex items-center justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Experience */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Work Experience</span>
              <button
                onClick={() => setExperience((p) => [...p, ''])}
                className="text-xs text-emerald-400 flex items-center gap-0.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line
              </button>
            </div>
            {experience.map((exp, idx) => (
              <div key={idx} className="flex gap-1.5">
                <input
                  value={exp}
                  onChange={(e) =>
                    setExperience((p) => p.map((x, i) => (i === idx ? e.target.value : x)))
                  }
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
                />
                <button
                  onClick={() => setExperience((p) => p.filter((_, i) => i !== idx))}
                  className="text-rose-400 px-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-1">
              Skills (Comma separated)
            </span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
            />
          </div>
        </div>

        {/* Right Live Print-Ready A4 CV Preview */}
        <div className="xl:col-span-7 flex justify-center">
          <div
            id="ik-print-area"
            style={{ width: '794px', minHeight: '1122px' }}
            className="bg-white text-slate-900 shadow-2xl p-10 font-sans"
          >
            {/* Header */}
            <div
              className={`flex items-start justify-between pb-5 mb-5 ${
                template === 'modern'
                  ? 'border-b-4 border-emerald-700'
                  : 'border-b-2 border-black'
              }`}
            >
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{name}</h1>
                <p
                  className={`text-base font-semibold mt-1 ${
                    template === 'modern' ? 'text-emerald-700' : 'text-slate-700'
                  }`}
                >
                  {role}
                </p>
                <div className="text-xs text-slate-700 mt-3 space-y-0.5">
                  <p>
                    <strong>Phone:</strong> {phone} {email && ` | Email: ${email}`}
                  </p>
                  <p>
                    <strong>Address:</strong> {address}
                  </p>
                </div>
              </div>
              {photo && (
                <img
                  src={photo}
                  alt="Applicant"
                  className="w-28 h-32 object-cover border-2 border-slate-300 rounded"
                />
              )}
            </div>

            {/* Career Objective */}
            <div className="mb-5">
              <h2
                className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 mb-2 ${
                  template === 'modern'
                    ? 'bg-emerald-50 text-emerald-900 border-l-4 border-emerald-700'
                    : 'bg-slate-200 text-black'
                }`}
              >
                Career Objective
              </h2>
              <p className="text-sm text-slate-800 leading-relaxed">{objective}</p>
            </div>

            {/* Personal Information */}
            <div className="mb-5">
              <h2
                className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 mb-2 ${
                  template === 'modern'
                    ? 'bg-emerald-50 text-emerald-900 border-l-4 border-emerald-700'
                    : 'bg-slate-200 text-black'
                }`}
              >
                Personal Information
              </h2>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-8 text-sm px-1">
                <div>
                  <strong>Father&apos;s Name:</strong> {fatherName}
                </div>
                <div>
                  <strong>CNIC No:</strong> {cnic}
                </div>
                <div>
                  <strong>Date of Birth:</strong> {dob}
                </div>
                <div>
                  <strong>Domicile:</strong> {domicile}
                </div>
                <div>
                  <strong>Marital Status:</strong> {marital}
                </div>
                <div>
                  <strong>Religion:</strong> {religion}
                </div>
              </div>
            </div>

            {/* Academic Qualification */}
            <div className="mb-5">
              <h2
                className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 mb-2 ${
                  template === 'modern'
                    ? 'bg-emerald-50 text-emerald-900 border-l-4 border-emerald-700'
                    : 'bg-slate-200 text-black'
                }`}
              >
                Academic Qualification
              </h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-3 py-1.5 text-left">Degree</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-left">
                      Board / University
                    </th>
                    <th className="border border-slate-300 px-3 py-1.5 text-center">Year</th>
                    <th className="border border-slate-300 px-3 py-1.5 text-center">
                      Grade / Div
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {education.map((ed, i) => (
                    <tr key={i}>
                      <td className="border border-slate-300 px-3 py-1.5 font-semibold">
                        {ed.degree}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5">{ed.board}</td>
                      <td className="border border-slate-300 px-3 py-1.5 text-center">{ed.year}</td>
                      <td className="border border-slate-300 px-3 py-1.5 text-center">
                        {ed.marks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Experience */}
            <div className="mb-5">
              <h2
                className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 mb-2 ${
                  template === 'modern'
                    ? 'bg-emerald-50 text-emerald-900 border-l-4 border-emerald-700'
                    : 'bg-slate-200 text-black'
                }`}
              >
                Work Experience
              </h2>
              <ul className="list-disc pl-6 text-sm space-y-1 text-slate-800">
                {experience.filter(Boolean).map((exp, idx) => (
                  <li key={idx}>{exp}</li>
                ))}
              </ul>
            </div>

            {/* Skills & Languages */}
            <div className="mb-5">
              <h2
                className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 mb-2 ${
                  template === 'modern'
                    ? 'bg-emerald-50 text-emerald-900 border-l-4 border-emerald-700'
                    : 'bg-slate-200 text-black'
                }`}
              >
                Skills & Languages
              </h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {skills
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((sk, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded bg-slate-100 border border-slate-300 text-xs font-semibold text-slate-800"
                    >
                      {sk}
                    </span>
                  ))}
              </div>
              <p className="text-sm text-slate-800 mt-3">
                <strong>Languages:</strong> Urdu, Punjabi & English
              </p>
            </div>

            <div className="mt-8 text-xs text-slate-600 italic">
              References will be furnished upon request.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
